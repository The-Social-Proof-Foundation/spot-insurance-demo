// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0

import { oracleKeyStatus } from "./chain.js";
import { env } from "./env.js";
import { startServer } from "./server.js";

const { url } = await startServer();
const key = oracleKeyStatus();

console.log(`
  SPoT + Insurance demo API
  -------------------------
  listening        ${url}
  myso rpc         ${env.mysoRpcUrl}
  chain graphql    ${env.graphqlUrl}
  social server    ${env.socialApiUrl}
  social package   ${env.socialPackageId}
  simulated oracle ${key.configured ? key.address : `NOT CONFIGURED (${key.error})`}
${key.configured ? "" : "  -> read-only mode: set SPOT_ORACLE_PRIVATE_KEY in .env to enable oracle actions\n"}`);
