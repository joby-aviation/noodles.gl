// The WebLLM engine, in a worker.
//
// Inference is a tight GPU-submit loop that runs for as long as the model is
// generating. On the main thread that competes with deck.gl's own render loop, so
// the map stutters for the whole answer. Here it does not.
//
// Everything else about this file is WebLLM's own protocol: the handler owns a
// real MLCEngine and answers the postMessage calls that WebWorkerMLCEngine makes
// on the other side.

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()

self.onmessage = (event: MessageEvent) => {
  handler.onmessage(event)
}
