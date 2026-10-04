// Copyright (c) The Social Proof Foundation, LLC.
// SPDX-License-Identifier: Apache-2.0

/** Error carrying an HTTP status for the demo API. */
export class OracleActionError extends Error {
  constructor(
    message: string,
    readonly status = 500,
  ) {
    super(message);
    this.name = "OracleActionError";
  }
}
