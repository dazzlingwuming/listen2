/* global AudioWorkletProcessor registerProcessor sampleRate Listen2Comfort */
/* Loaded after comfort_loudness_core.js in the same AudioWorkletGlobalScope. */
class Listen2ComfortWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new Listen2Comfort.ComfortProcessor(sampleRate);
    this.reportFrames = 0;
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'dispose') {
        this.disposed = true;
        this.engine = null;
        this.port.onmessage = null;
        if (typeof this.port.close === 'function') this.port.close();
        return;
      }
      if (event.data && event.data.type === 'configure')
        this.engine.configure(event.data.options);
    };
    this.port.postMessage({ type: 'ready', state: this.engine.state() });
  }

  process(inputs, outputs) {
    if (this.disposed) {
      outputs[0].forEach((channel) => channel.fill(0));
      return false;
    }
    this.engine.process(inputs[0] || [], inputs[1] || [], outputs[0]);
    this.reportFrames += outputs[0][0].length;
    if (this.reportFrames >= sampleRate / 4) {
      this.reportFrames = 0;
      this.port.postMessage({ type: 'state', state: this.engine.state() });
    }
    return true;
  }
}
registerProcessor('listen2-comfort', Listen2ComfortWorklet);
