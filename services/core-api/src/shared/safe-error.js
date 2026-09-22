export function safeErrorMetadata(error) {
  return {
    errorName: error?.name ?? 'Error',
    ...(typeof error?.code === 'string' || typeof error?.code === 'number' ? { errorCode: error.code } : {})
  };
}
