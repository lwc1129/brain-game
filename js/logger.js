export function logError(context, error) {
  console.error(
    JSON.stringify({
      level: 'error',
      ts: new Date().toISOString(),
      ctx: context,
      msg: error?.message ?? String(error),
    })
  );
}
