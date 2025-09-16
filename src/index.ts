import { inflate } from 'pako'
import nodeFetch from 'node-fetch'
import https from 'node:https'

async function transformLogs(obj: any) {
  const encoding = obj.contentEncoding || undefined
  let payload = obj.payload
  const jobname = obj.job || 'cloudflare_logpush'

  const lokiFormat = {
    streams: [
      {
        stream: {
          job: jobname,
        },
        values: [],
      },
    ],
  }

  let log

  if (encoding === 'gzip') {
    payload = await payload.arrayBuffer()

    const data = inflate(payload)
    const logdata = new Uint16Array(data).reduce((data, byte) => data + String.fromCharCode(byte), '')
    log = logdata.split('\n')
  } else {
    const date = new Date().getTime() * 1000000
    if (obj.contentType.includes('application/json')) {
      log = await payload.json()
    }
    if (obj.contentType.includes('application/text')) {
      log = await payload.text()
    }
    // @ts-expect-error - from the original code
    lokiFormat.streams[0].values.push([date.toString(), JSON.stringify(log)])
    return lokiFormat
  }

  log.forEach((element) => {
    const date = element.EdgeStartTimestamp || new Date().getTime() * 1000000
    // @ts-expect-error - from the original code
    lokiFormat.streams[0].values.push([date.toString(), element])
  })

  return lokiFormat
}

async function pushLogs(
  payload: {
    streams: {
      stream: {
        job: any
      }
      values: never[]
    }[]
  },
  env: Env,
) {
  console.log('Pre agent')
  const agent = new https.Agent({
    cert: env.tls_cert,
    key: env.tls_key,
    ca: env.ca_cert,
    // The 'rejectUnauthorized: false' option is the equivalent of curl's '--insecure'
    // It disables SSL/TLS certificate verification. Use this with caution! ⚠️
    rejectUnauthorized: false,
  })
  console.log('Post agent')

  const lokiServer = env.lokiHost

  console.log('Pre fetch')
  const req = await nodeFetch(lokiServer, {
    agent: agent,
    body: JSON.stringify(payload),
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  })

  console.log('Post fetch')

  return req
}

export default {
  async fetch(request, env) {
    const { searchParams } = new URL(request.url)
    const job = searchParams.get('job') || "cloudflare-worker-logs";
    const contentEncoding = request.headers.get('content-encoding')
    const contentType = request.headers.get('content-type')

    if (request.method !== 'POST') {
      console.log('Not a post')

      return new Response(
        JSON.stringify(
          { success: false, message: 'please authenticate and use POST requests' },
          // @ts-expect-error - from the original code
          { headers: { 'content-type': 'application/json' } },
        ),
      )
    }

    console.log('Pre transform')

    const output = await transformLogs({ payload: request, contentEncoding, job, contentType })

    console.log('Post transform')

    console.log('Pre push')

    await pushLogs(output, env)

    console.log('Post push')

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'content-type': 'application/json' },
    })
  },
} satisfies ExportedHandler<Env>
