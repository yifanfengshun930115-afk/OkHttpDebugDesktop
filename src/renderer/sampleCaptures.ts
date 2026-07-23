import type { CaptureRecord } from '../shared/protocol.js';

const baseStartedAt = Date.now() - 1000 * 60 * 7;

const app = {
  packageName: 'com.bulletin.message',
  versionName: '7.9.0',
  versionCode: 790,
  debuggable: true
};

const device = {
  manufacturer: 'Google',
  model: 'Pixel 8',
  sdkInt: 35,
  deviceTag: 'android:sample'
};

function capture(
  partial: Omit<CaptureRecord, 'type' | 'protocolVersion' | 'receivedAtEpochMs' | 'source' | 'groupId' | 'stage'> &
    Partial<Pick<CaptureRecord, 'groupId' | 'stage'>>
): CaptureRecord {
  return {
    type: 'capture',
    protocolVersion: 1,
    receivedAtEpochMs: partial.startedAtEpochMs + (partial.durationMs ?? 0) + 18,
    source: {
      app,
      device,
      clientTag: 'OneNews debug'
    },
    ...partial,
    groupId: partial.groupId ?? partial.id,
    stage: partial.stage ?? 'plain'
  };
}

export const sampleCaptures: CaptureRecord[] = [
  capture({
    id: 'sample-news-list',
    startedAtEpochMs: baseStartedAt,
    durationMs: 182,
    request: {
      method: 'POST',
      url: 'https://news-api.example.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'User-Agent': 'OneNews/7.9.0 okhttp/4.12.0'
      },
      body: 'field=getNewsList&category=top&page=1&pageSize=20&token=<redacted>',
      contentType: 'application/x-www-form-urlencoded',
      contentLength: 72
    },
    response: {
      code: 200,
      message: 'OK',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(
        {
          code: 0,
          data: {
            field: 'getNewsList',
            category: 'top',
            items: [
              { id: 'demo-1001', title: 'Global markets open mixed', source: 'Demo Wire' },
              { id: 'demo-1002', title: 'Morning technology briefing', source: 'Demo Wire' }
            ]
          }
        },
        null,
        2
      ),
      contentType: 'application/json; charset=utf-8',
      contentLength: 238
    },
    timing: {
      dnsMs: 12,
      connectMs: 29,
      tlsMs: 34,
      requestBodyMs: 2,
      serverMs: 85,
      responseBodyMs: 20
    }
  }),
  capture({
    id: 'sample-news-detail',
    startedAtEpochMs: baseStartedAt + 1000 * 36,
    durationMs: 136,
    request: {
      method: 'POST',
      url: 'https://news-api.example.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: 'field=getNewsDetail&id=demo-1001&token=<redacted>',
      contentType: 'application/x-www-form-urlencoded',
      contentLength: 51
    },
    response: {
      code: 200,
      message: 'OK',
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(
        {
          code: 0,
          data: {
            id: 'demo-1001',
            field: 'getNewsDetail',
            title: 'Global markets open mixed',
            bodyPreview: 'Sample article payload trimmed for desktop inspection.'
          }
        },
        null,
        2
      ),
      contentType: 'application/json',
      contentLength: 198
    },
    timing: {
      dnsMs: 4,
      connectMs: 18,
      requestBodyMs: 1,
      serverMs: 91,
      responseBodyMs: 22
    }
  }),
  capture({
    id: 'sample-hot-search',
    startedAtEpochMs: baseStartedAt + 1000 * 76,
    durationMs: 94,
    request: {
      method: 'POST',
      url: 'https://news-api.example.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: 'field=hotSearchKeywords&token=<redacted>',
      contentType: 'application/x-www-form-urlencoded',
      contentLength: 40
    },
    response: {
      code: 200,
      message: 'OK',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        {
          code: 0,
          data: {
            field: 'hotSearchKeywords',
            keywords: ['weather', 'election', 'sports', 'technology']
          }
        },
        null,
        2
      ),
      contentType: 'application/json',
      contentLength: 124
    },
    timing: {
      requestBodyMs: 1,
      serverMs: 72,
      responseBodyMs: 21
    }
  }),
  capture({
    id: 'sample-category-error',
    startedAtEpochMs: baseStartedAt + 1000 * 121,
    durationMs: 512,
    request: {
      method: 'POST',
      url: 'https://news-api.example.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: 'field=allTopCategory&token=<redacted>',
      contentType: 'application/x-www-form-urlencoded',
      contentLength: 37
    },
    response: {
      code: 503,
      message: 'Service Unavailable',
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': '30'
      },
      body: JSON.stringify({ code: 503, message: 'temporary upstream throttle' }, null, 2),
      contentType: 'application/json',
      contentLength: 60
    },
    timing: {
      connectMs: 31,
      serverMs: 456,
      responseBodyMs: 25
    }
  }),
  capture({
    id: 'sample-realtime-weather',
    startedAtEpochMs: baseStartedAt + 1000 * 171,
    durationMs: 211,
    request: {
      method: 'POST',
      url: 'https://weather-api.example.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: 'field=realtimeWeather&lat=31.2304&lng=121.4737&token=<redacted>',
      contentType: 'application/x-www-form-urlencoded',
      contentLength: 68
    },
    response: {
      code: 200,
      message: 'OK',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        {
          code: 0,
          data: {
            field: 'realtimeWeather',
            city: 'Shanghai',
            tempC: 28,
            condition: 'Cloudy'
          }
        },
        null,
        2
      ),
      contentType: 'application/json',
      contentLength: 138
    },
    timing: {
      dnsMs: 9,
      connectMs: 24,
      tlsMs: 39,
      serverMs: 112,
      responseBodyMs: 27
    }
  }),
  capture({
    id: 'sample-daily-weather-timeout',
    startedAtEpochMs: baseStartedAt + 1000 * 229,
    durationMs: 10012,
    request: {
      method: 'POST',
      url: 'https://weather-api.example.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: 'field=dailyWeatherV2&key=shanghai&days=7&token=<redacted>',
      contentType: 'application/x-www-form-urlencoded',
      contentLength: 61
    },
    error: {
      type: 'java.net.SocketTimeoutException',
      message: 'timeout',
      stack: 'okhttp3.internal.http.RealInterceptorChain.proceed(RealInterceptorChain.kt:109)\nretrofit2.OkHttpCall.execute(OkHttpCall.java:204)'
    },
    timing: {
      dnsMs: 8,
      connectMs: 23,
      tlsMs: 37,
      serverMs: 9944
    }
  }),
  capture({
    id: 'sample-aqi-feed',
    startedAtEpochMs: baseStartedAt + 1000 * 277,
    durationMs: 244,
    request: {
      method: 'GET',
      url: 'https://api.waqi.info/feed/shanghai/?token=<redacted>',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'OneNews/7.9.0 okhttp/4.12.0'
      }
    },
    response: {
      code: 200,
      message: 'OK',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        {
          status: 'ok',
          data: {
            aqi: 62,
            city: { name: 'Shanghai' },
            attribution: 'WAQI demo payload'
          }
        },
        null,
        2
      ),
      contentType: 'application/json',
      contentLength: 126
    },
    timing: {
      dnsMs: 11,
      connectMs: 30,
      tlsMs: 46,
      serverMs: 130,
      responseBodyMs: 27
    }
  }),
  capture({
    id: 'sample-billing-order',
    startedAtEpochMs: baseStartedAt + 1000 * 329,
    durationMs: 168,
    request: {
      method: 'POST',
      url: 'https://billing-api.example.com/api',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json'
      },
      body: 'field=getGoogleOrderInfo&orderId=GPA.0000-0000-0000-00000&token=<redacted>',
      contentType: 'application/x-www-form-urlencoded',
      contentLength: 79
    },
    response: {
      code: 200,
      message: 'OK',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(
        {
          code: 0,
          data: {
            field: 'getGoogleOrderInfo',
            orderId: 'GPA.0000-0000-0000-00000',
            status: 'acknowledged'
          }
        },
        null,
        2
      ),
      contentType: 'application/json',
      contentLength: 157
    },
    timing: {
      connectMs: 21,
      tlsMs: 32,
      requestBodyMs: 2,
      serverMs: 89,
      responseBodyMs: 24
    }
  })
];
