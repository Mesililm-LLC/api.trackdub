import { beforeAll } from "vitest";
import { migrate } from "../support/activation-env";

/** Apply the activation migrations to this file's in-process PostgreSQL once. */
beforeAll(async () => {
  await migrate();
});
