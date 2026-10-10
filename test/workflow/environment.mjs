/** Pure guard shared by the launcher and fixture; no imports or connections. */
export function validateWorkflowEnvironment(env) {
  if (env.WORKFLOW_DB_TESTS !== 'true') throw new Error('Explicit WORKFLOW_DB_TESTS=true is required');
  const urls = ['TEST_DATABASE_URL', 'OWNER_TEST_DATABASE_URL'].map(key => {
    if (!env[key]) throw new Error(`Explicit ${key} is required`);
    let u;
    try { u = new URL(env[key]); } catch { throw new Error(`Unsafe ${key}`); }
    const existing = u.hostname === 'localhost' && u.port === '5433' && u.pathname === '/thesocialpundit_test';
    const disposable = u.hostname === '127.0.0.1' && Number(u.port) > 0 && !['5432', '5433'].includes(u.port) &&
      u.pathname === '/thesocialpundit_acceptance_test';
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !(existing || disposable) ||
        env[key].includes('?') || env[key].includes('#') || !u.username ||
        (key === 'TEST_DATABASE_URL' ? u.username !== 'tsp_app' : u.username === 'tsp_app')) {
      throw new Error(`Unsafe ${key}; explicit approved local restricted/owner test URLs required`);
    }
    return u;
  });
  if (urls[0].hostname !== urls[1].hostname || urls[0].port !== urls[1].port || urls[0].pathname !== urls[1].pathname) {
    throw new Error('Workflow runtime and owner must target the same database');
  }
  if (env.PGOPTIONS) throw new Error('PGOPTIONS is forbidden');
  return { port: Number(urls[0].port), database: urls[0].pathname.slice(1), host: urls[0].hostname };
}