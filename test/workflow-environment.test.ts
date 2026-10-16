import { describe, expect, it } from 'vitest';
import { validateWorkflowEnvironment } from './workflow/environment.mjs';

const env = {
  WORKFLOW_DB_TESTS: 'true',
  TEST_DATABASE_URL: 'postgresql://tsp_app:localtestpass@127.0.0.1:60053/thesocialpundit_acceptance_test',
  OWNER_TEST_DATABASE_URL: 'postgresql://owner@127.0.0.1:60053/thesocialpundit_acceptance_test',
};
describe('workflow target guard without database connections', () => {
  it('accepts matching explicitly isolated endpoints', () => {
    expect(validateWorkflowEnvironment(env)).toEqual({ host: '127.0.0.1', port: 60053, database: 'thesocialpundit_acceptance_test' });
  });
  it.each([
    { WORKFLOW_DB_TESTS: undefined }, { OWNER_TEST_DATABASE_URL: undefined }, { PGOPTIONS: '-c role=owner' },
    { TEST_DATABASE_URL: env.TEST_DATABASE_URL.replace('60053', '5433') },
    { TEST_DATABASE_URL: env.TEST_DATABASE_URL.replace('60053', '5432') },
    { TEST_DATABASE_URL: env.TEST_DATABASE_URL.replace('127.0.0.1', 'remote') },
    { TEST_DATABASE_URL: env.TEST_DATABASE_URL.replace('tsp_app', 'owner') },
    { TEST_DATABASE_URL: env.TEST_DATABASE_URL + '?host=remote' },
    { TEST_DATABASE_URL: env.TEST_DATABASE_URL + '#' },
    { OWNER_TEST_DATABASE_URL: env.OWNER_TEST_DATABASE_URL.replace('60053', '60054') },
    { OWNER_TEST_DATABASE_URL: env.OWNER_TEST_DATABASE_URL.replace('owner', 'tsp_app') },
  ])('rejects unsafe prerequisites %#', override => {
    expect(() => validateWorkflowEnvironment({ ...env, ...override })).toThrow();
  });
});