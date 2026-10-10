import config from "../vitest.config";

// Temporary isolated review verification: never inspect repository .env files.
export default { ...config, envDir: "/dev/null" };