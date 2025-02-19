import ddTrace from 'dd-trace'
ddTrace.init({
  profiling: false, // Disable CPU profiling
  runtimeMetrics: false, // Disable extra runtime metrics
  logInjection: false, // Reduce log processing
  reportHostname: false, // Avoid hostname reporting overhead
  flushInterval: 5000, // Reduce the frequency of requests to Datadog agent
  experimental: { b3: true }, // Use B3 headers for lower overhead
});
export default ddTrace

export const getTraceId = () => {
  const span = ddTrace.scope().active()
  return span ? span.context().toTraceId() : undefined
}

export const getSpanId = () => {
  const span = ddTrace.scope().active()
  return span ? span.context().toSpanId() : undefined
}

export const addDataDogTagsToSpan = (kv: {[key: string]: any}) => {
  const span = ddTrace.scope().active()
  if (span) {
    span.addTags(kv)
  }
}

export const sendErrorToDatadog = (err: Error) => {
    try {
      addDataDogTagsToSpan({
        'error.msg': err.message,
        'error.type': err.name,
        'error.stack': err.stack
      });
    } catch (loggingError) {
      console.log('Failed to send error to Datadog:', loggingError);
    }
  };
  