import { BigQuery, type BigQueryOptions } from "@google-cloud/bigquery";
import { config } from "../config.js";

let client: BigQuery | null = null;

function buildBigQueryOptions(): BigQueryOptions {
  const options: BigQueryOptions = { projectId: config.BIGQUERY_PROJECT_ID };
  const keyInput = config.BIGQUERY_KEY_JSON;

  if (!keyInput) {
    return options;
  }

  if (keyInput.trim().startsWith("{")) {
    options.credentials = JSON.parse(keyInput);
    return options;
  }

  options.keyFilename = keyInput;
  return options;
}

export function getBigQueryClient(): BigQuery {
  if (!client) {
    client = new BigQuery(buildBigQueryOptions());
  }

  return client;
}
