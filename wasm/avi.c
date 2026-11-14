// AVI decoder for Media Viewer, built to WebAssembly with Emscripten (see build.sh).
//
// The whole file sits in WebAssembly memory. avi_open() reads it with FFmpeg's AVI demuxer and
// opens one video and one audio decoder; avi_next() then hands out decoded media one piece at a
// time: a video frame scaled to I420 at the stream's (even) size, or audio resampled to 48 kHz
// interleaved float, stereo or mono. JavaScript re-encodes them with WebCodecs into MP4.
//
// FFmpeg is LGPL-2.1-or-later; this file and the build are LGPL-2.1-or-later too (see LICENSE).

#include <emscripten/emscripten.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/imgutils.h>
#include <libavutil/log.h>
#include <libavutil/opt.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
#include <stdint.h>
#include <string.h>

#define OUT_RATE 48000
#define IO_BUFFER 65536

// Errors returned to JavaScript.
#define ERR_NOT_AVI -2
#define ERR_NO_STREAMS -3
#define ERR_VIDEO_CODEC -4
#define ERR_DECODER -5

typedef struct {
  const uint8_t *data;
  int64_t size;
  int64_t pos;
} MemSource;

// FFmpeg 7.1's H.264 SEI code calls this AV1 film-grain cleanup even when no AV1 code is built.
// AVI never carries AV1 film grain, so there is nothing to free.
void ff_aom_uninit_film_grain_params(void *params) { (void)params; }

static MemSource source;
static AVFormatContext *fmt = NULL;
static AVIOContext *avio = NULL;
static AVCodecContext *vdec = NULL;
static AVCodecContext *adec = NULL;
static int vidx = -1;
static int aidx = -1;
static AVPacket *pkt = NULL;
static AVFrame *frame = NULL;
static struct SwsContext *sws = NULL;
static SwrContext *swr = NULL;

static int out_w = 0;
static int out_h = 0;
static int out_channels = 0;
static double fps = 25;
static uint8_t *video_buf = NULL;
static int video_size = 0;
static double video_pts = 0;
static double last_video_pts = -1;

static float *audio_buf = NULL;
static int audio_cap = 0; // in frames
static int audio_frames = 0;
static double audio_pts = 0;
static double audio_start = -1;
static int64_t audio_total = 0;

static int pending = 0;     // decoder to drain: 1 video, 2 audio
static int eof = 0;
static int flush_stage = 0; // after the end of the file: 0 video, 1 audio, 2 resampler, 3 done
static char unsupported[64] = "";

static int read_packet(void *opaque, uint8_t *buf, int buf_size) {
  MemSource *s = (MemSource *)opaque;
  int64_t left = s->size - s->pos;
  if (left <= 0) return AVERROR_EOF;
  int n = buf_size < left ? buf_size : (int)left;
  memcpy(buf, s->data + s->pos, n);
  s->pos += n;
  return n;
}

static int64_t seek_source(void *opaque, int64_t offset, int whence) {
  MemSource *s = (MemSource *)opaque;
  int64_t next;
  switch (whence & ~AVSEEK_FORCE) {
    case AVSEEK_SIZE: return s->size;
    case SEEK_SET: next = offset; break;
    case SEEK_CUR: next = s->pos + offset; break;
    case SEEK_END: next = s->size + offset; break;
    default: return -1;
  }
  if (next < 0 || next > s->size) return -1;
  s->pos = next;
  return next;
}

static AVCodecContext *open_decoder(AVStream *st) {
  const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
  if (!codec) return NULL;
  AVCodecContext *c = avcodec_alloc_context3(codec);
  if (!c) return NULL;
  if (avcodec_parameters_to_context(c, st->codecpar) < 0 || avcodec_open2(c, codec, NULL) < 0) {
    avcodec_free_context(&c);
    return NULL;
  }
  c->pkt_timebase = st->time_base;
  return c;
}

EMSCRIPTEN_KEEPALIVE void avi_close(void) {
  avcodec_free_context(&vdec);
  avcodec_free_context(&adec);
  if (fmt) avformat_close_input(&fmt);
  if (avio) {
    av_freep(&avio->buffer);
    avio_context_free(&avio);
  }
  av_packet_free(&pkt);
  av_frame_free(&frame);
  sws_freeContext(sws);
  sws = NULL;
  swr_free(&swr);
  av_freep(&video_buf);
  av_freep(&audio_buf);
  vidx = aidx = -1;
  out_w = out_h = out_channels = 0;
  video_size = audio_cap = audio_frames = 0;
  last_video_pts = -1;
  audio_start = -1;
  audio_total = 0;
  pending = eof = flush_stage = 0;
  unsupported[0] = 0;
}

EMSCRIPTEN_KEEPALIVE uint8_t *avi_alloc(int size) { return av_malloc(size); }
EMSCRIPTEN_KEEPALIVE void avi_free(void *ptr) { av_free(ptr); }

/** Opens the file at data. 0 on success, a negative ERR_* code otherwise. */
EMSCRIPTEN_KEEPALIVE int avi_open(const uint8_t *data, int size) {
  avi_close();
  av_log_set_level(AV_LOG_FATAL); // no console noise from broken frames or pixel formats
  source.data = data;
  source.size = size;
  source.pos = 0;
  uint8_t *buffer = av_malloc(IO_BUFFER);
  avio = avio_alloc_context(buffer, IO_BUFFER, 0, &source, read_packet, NULL, seek_source);
  fmt = avformat_alloc_context();
  if (!avio || !fmt) return ERR_DECODER;
  fmt->pb = avio;
  fmt->flags |= AVFMT_FLAG_CUSTOM_IO;
  const AVInputFormat *avi = av_find_input_format("avi");
  if (avformat_open_input(&fmt, NULL, avi, NULL) < 0) return ERR_NOT_AVI;
  if (avformat_find_stream_info(fmt, NULL) < 0) return ERR_NOT_AVI;

  vidx = av_find_best_stream(fmt, AVMEDIA_TYPE_VIDEO, -1, -1, NULL, 0);
  aidx = av_find_best_stream(fmt, AVMEDIA_TYPE_AUDIO, -1, -1, NULL, 0);
  if (vidx < 0) vidx = -1;
  if (aidx < 0) aidx = -1;

  if (vidx >= 0) {
    AVStream *st = fmt->streams[vidx];
    vdec = open_decoder(st);
    if (!vdec) {
      const AVCodecDescriptor *d = avcodec_descriptor_get(st->codecpar->codec_id);
      char tag[AV_FOURCC_MAX_STRING_SIZE] = "";
      av_fourcc_make_string(tag, st->codecpar->codec_tag);
      snprintf(unsupported, sizeof unsupported, "%s", d ? d->name : tag);
      return ERR_VIDEO_CODEC;
    }
    out_w = st->codecpar->width & ~1;
    out_h = st->codecpar->height & ~1;
    if (out_w <= 0 || out_h <= 0) return ERR_DECODER;
    AVRational r = st->avg_frame_rate.num ? st->avg_frame_rate : st->r_frame_rate;
    if (r.num > 0 && r.den > 0) fps = av_q2d(r);
    if (!(fps > 0 && fps < 1000)) fps = 25;
    video_size = av_image_get_buffer_size(AV_PIX_FMT_YUV420P, out_w, out_h, 1);
    video_buf = av_malloc(video_size);
  }
  if (aidx >= 0) {
    adec = open_decoder(fmt->streams[aidx]);
    if (!adec) aidx = -1; // play the video silently rather than refuse the file
    else out_channels = adec->ch_layout.nb_channels >= 2 ? 2 : 1;
  }
  if (vidx < 0 && aidx < 0) return ERR_NO_STREAMS;
  pkt = av_packet_alloc();
  frame = av_frame_alloc();
  return 0;
}

EMSCRIPTEN_KEEPALIVE const char *avi_unsupported_codec(void) { return unsupported; }
EMSCRIPTEN_KEEPALIVE int avi_has_video(void) { return vidx >= 0; }
EMSCRIPTEN_KEEPALIVE int avi_has_audio(void) { return aidx >= 0; }
EMSCRIPTEN_KEEPALIVE int avi_width(void) { return out_w; }
EMSCRIPTEN_KEEPALIVE int avi_height(void) { return out_h; }
EMSCRIPTEN_KEEPALIVE double avi_fps(void) { return fps; }
EMSCRIPTEN_KEEPALIVE int avi_channels(void) { return out_channels; }
EMSCRIPTEN_KEEPALIVE int avi_sample_rate(void) { return OUT_RATE; }

EMSCRIPTEN_KEEPALIVE double avi_duration(void) {
  if (fmt && fmt->duration != AV_NOPTS_VALUE) return fmt->duration / (double)AV_TIME_BASE;
  return 0;
}

EMSCRIPTEN_KEEPALIVE const char *avi_video_codec(void) {
  return vdec ? vdec->codec->name : "";
}

EMSCRIPTEN_KEEPALIVE const char *avi_audio_codec(void) {
  return adec ? adec->codec->name : "";
}

EMSCRIPTEN_KEEPALIVE uint8_t *avi_video_data(void) { return video_buf; }
EMSCRIPTEN_KEEPALIVE int avi_video_size(void) { return video_size; }
EMSCRIPTEN_KEEPALIVE double avi_video_pts(void) { return video_pts; }
EMSCRIPTEN_KEEPALIVE float *avi_audio_data(void) { return audio_buf; }
EMSCRIPTEN_KEEPALIVE int avi_audio_frames(void) { return audio_frames; }
EMSCRIPTEN_KEEPALIVE double avi_audio_pts(void) { return audio_pts; }

/** Read position in the file, for progress. */
EMSCRIPTEN_KEEPALIVE double avi_position(void) {
  return source.size > 0 ? (double)source.pos / (double)source.size : 0;
}

static double frame_seconds(AVFrame *f, AVStream *st) {
  int64_t ts = f->best_effort_timestamp;
  if (ts == AV_NOPTS_VALUE) ts = f->pts;
  if (ts == AV_NOPTS_VALUE) return -1;
  int64_t start = st->start_time == AV_NOPTS_VALUE ? 0 : st->start_time;
  return (ts - start) * av_q2d(st->time_base);
}

static int emit_video(void) {
  sws = sws_getCachedContext(sws, frame->width, frame->height, frame->format, out_w, out_h,
                             AV_PIX_FMT_YUV420P, SWS_BILINEAR, NULL, NULL, NULL);
  if (!sws) return ERR_DECODER;
  uint8_t *planes[4];
  int strides[4];
  av_image_fill_arrays(planes, strides, video_buf, AV_PIX_FMT_YUV420P, out_w, out_h, 1);
  sws_scale(sws, (const uint8_t *const *)frame->data, frame->linesize, 0, frame->height, planes,
            strides);
  double t = frame_seconds(frame, fmt->streams[vidx]);
  // Keep presentation times strictly increasing: the encoder and the MP4 need it.
  if (t < 0 || t <= last_video_pts) t = last_video_pts < 0 ? 0 : last_video_pts + 1.0 / fps;
  last_video_pts = t;
  video_pts = t;
  av_frame_unref(frame);
  return 1;
}

static int ensure_audio(int frames) {
  if (frames <= audio_cap) return 0;
  av_freep(&audio_buf);
  audio_buf = av_malloc((size_t)frames * out_channels * sizeof(float));
  if (!audio_buf) return ERR_DECODER;
  audio_cap = frames;
  return 0;
}

static int resample(const uint8_t **in, int in_frames) {
  int want = swr_get_out_samples(swr, in_frames);
  if (want <= 0) return 0;
  if (ensure_audio(want) < 0) return ERR_DECODER;
  uint8_t *out[1] = {(uint8_t *)audio_buf};
  int got = swr_convert(swr, out, want, in, in_frames);
  if (got <= 0) return 0;
  audio_frames = got;
  audio_pts = (audio_start < 0 ? 0 : audio_start) + audio_total / (double)OUT_RATE;
  audio_total += got;
  return 2;
}

static int emit_audio(void) {
  if (!swr) {
    AVChannelLayout out_layout;
    av_channel_layout_default(&out_layout, out_channels);
    if (swr_alloc_set_opts2(&swr, &out_layout, AV_SAMPLE_FMT_FLT, OUT_RATE, &frame->ch_layout,
                            frame->format, frame->sample_rate, 0, NULL) < 0 ||
        swr_init(swr) < 0) {
      av_frame_unref(frame);
      aidx = -1; // give up on the sound, keep the picture
      return 0;
    }
    double t = frame_seconds(frame, fmt->streams[aidx]);
    audio_start = t < 0 ? 0 : t;
  }
  int r = resample((const uint8_t **)frame->extended_data, frame->nb_samples);
  av_frame_unref(frame);
  return r;
}

/**
 * Decodes until the next piece of media: 1 a video frame (avi_video_*), 2 audio (avi_audio_*),
 * 0 the end of the file, below 0 an error.
 */
EMSCRIPTEN_KEEPALIVE int avi_next(void) {
  for (;;) {
    if (pending) {
      AVCodecContext *c = pending == 1 ? vdec : adec;
      int r = c ? avcodec_receive_frame(c, frame) : AVERROR_EOF;
      if (r == 0) {
        int out = pending == 1 ? emit_video() : (aidx >= 0 ? emit_audio() : 0);
        if (out != 0) return out;
        continue;
      }
      // EAGAIN: the decoder wants more input; EOF: drained; anything else: a broken packet,
      // which a player skips rather than stopping.
      pending = 0;
    }
    if (eof) {
      if (flush_stage == 0) {
        flush_stage = 1;
        if (vdec) {
          avcodec_send_packet(vdec, NULL);
          pending = 1;
        }
        continue;
      }
      if (flush_stage == 1) {
        flush_stage = 2;
        if (adec && aidx >= 0) {
          avcodec_send_packet(adec, NULL);
          pending = 2;
        }
        continue;
      }
      if (flush_stage == 2) {
        flush_stage = 3;
        if (swr && aidx >= 0) {
          int r = resample(NULL, 0);
          if (r != 0) return r;
        }
        continue;
      }
      return 0;
    }
    int r = av_read_frame(fmt, pkt);
    if (r < 0) {
      eof = 1;
      continue;
    }
    if (pkt->stream_index == vidx && vdec) {
      if (avcodec_send_packet(vdec, pkt) >= 0) pending = 1;
    } else if (pkt->stream_index == aidx && adec) {
      if (avcodec_send_packet(adec, pkt) >= 0) pending = 2;
    }
    av_packet_unref(pkt);
  }
}
