export function validateWorkflowEnvironment(env: Record<string, string | undefined>): {
  port: number;
  database: string;
  host: string;
};