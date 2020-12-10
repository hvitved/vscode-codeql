import { env, TreeItem } from 'vscode';

import { QueryWithResults, tmpDir, QueryInfo } from './run-queries';
import * as messages from './pure/messages';
import * as cli from './cli';
import * as sarif from 'sarif';
import * as fs from 'fs-extra';
import * as path from 'path';
import { RawResultsSortState, SortedResultSetInfo, DatabaseInfo, QueryMetadata, InterpretedResultsSortState, ResultsPaths, SarifInterpretationData, GraphInterpretationData } from './pure/interface-types';
import { QueryHistoryConfig } from './config';
import { QueryHistoryItemOptions } from './query-history';

/**
 * The version of the SARIF format that we are using.
 */
const SARIF_FORMAT = 'sarifv2.1.0';

export class CompletedQuery implements QueryWithResults {
  readonly time: string;
  readonly query: QueryInfo;
  readonly result: messages.EvaluationResult;
  readonly database: DatabaseInfo;
  readonly logFileLocation?: string;
  options: QueryHistoryItemOptions;
  treeItem?: TreeItem;
  dispose: () => void;

  /**
   * Map from result set name to SortedResultSetInfo.
   */
  sortedResultsInfo: Map<string, SortedResultSetInfo>;

  /**
   * How we're currently sorting alerts. This is not mere interface
   * state due to truncation; on re-sort, we want to read in the file
   * again, sort it, and only ship off a reasonable number of results
   * to the webview. Undefined means to use whatever order is in the
   * sarif file.
   */
  interpretedResultsSortState: InterpretedResultsSortState | undefined;

  constructor(
    evaluation: QueryWithResults,
    public config: QueryHistoryConfig,
  ) {
    this.query = evaluation.query;
    this.result = evaluation.result;
    this.database = evaluation.database;
    this.logFileLocation = evaluation.logFileLocation;
    this.options = evaluation.options;
    this.dispose = evaluation.dispose;

    this.time = new Date().toLocaleString(env.language);
    this.sortedResultsInfo = new Map();
  }

  get databaseName(): string {
    return this.database.name;
  }
  get queryName(): string {
    return getQueryName(this.query);
  }

  get statusString(): string {
    switch (this.result.resultType) {
      case messages.QueryResultType.CANCELLATION:
        return `cancelled after ${this.result.evaluationTime / 1000} seconds`;
      case messages.QueryResultType.OOM:
        return 'out of memory';
      case messages.QueryResultType.SUCCESS:
        return `finished in ${this.result.evaluationTime / 1000} seconds`;
      case messages.QueryResultType.TIMEOUT:
        return `timed out after ${this.result.evaluationTime / 1000} seconds`;
      case messages.QueryResultType.OTHER_ERROR:
      default:
        return this.result.message ? `failed: ${this.result.message}` : 'failed';
    }
  }

  getResultsPath(selectedTable: string, useSorted = true): string {
    if (!useSorted) {
      return this.query.resultsPaths.resultsPath;
    }
    return this.sortedResultsInfo.get(selectedTable)?.resultsPath
      || this.query.resultsPaths.resultsPath;
  }

  interpolate(template: string): string {
    const { databaseName, queryName, time, statusString } = this;
    const replacements: { [k: string]: string } = {
      t: time,
      q: queryName,
      d: databaseName,
      s: statusString,
      '%': '%',
    };
    return template.replace(/%(.)/g, (match, key) => {
      const replacement = replacements[key];
      return replacement !== undefined ? replacement : match;
    });
  }

  getLabel(): string {
    return this.options?.label
      || this.config.format;
  }

  get didRunSuccessfully(): boolean {
    return this.result.resultType === messages.QueryResultType.SUCCESS;
  }

  toString(): string {
    return this.interpolate(this.getLabel());
  }

  async updateSortState(
    server: cli.CodeQLCliServer,
    resultSetName: string,
    sortState?: RawResultsSortState
  ): Promise<void> {
    if (sortState === undefined) {
      this.sortedResultsInfo.delete(resultSetName);
      return;
    }

    const sortedResultSetInfo: SortedResultSetInfo = {
      resultsPath: path.join(tmpDir.name, `sortedResults${this.query.queryID}-${resultSetName}.bqrs`),
      sortState
    };

    await server.sortBqrs(
      this.query.resultsPaths.resultsPath,
      sortedResultSetInfo.resultsPath,
      resultSetName,
      [sortState.columnIndex],
      [sortState.sortDirection]
    );
    this.sortedResultsInfo.set(resultSetName, sortedResultSetInfo);
  }

  async updateInterpretedSortState(sortState?: InterpretedResultsSortState): Promise<void> {
    this.interpretedResultsSortState = sortState;
  }
}


/**
 * Gets a human-readable name for an evaluated query.
 * Uses metadata if it exists, and defaults to the query file name.
 */
export function getQueryName(query: QueryInfo) {
  // Queries run through quick evaluation are not usually the entire query file.
  // Label them differently and include the line numbers.
  if (query.quickEvalPosition !== undefined) {
    const { line, endLine, fileName } = query.quickEvalPosition;
    const lineInfo = line === endLine ? `${line}` : `${line}-${endLine}`;
    return `Quick evaluation of ${path.basename(fileName)}:${lineInfo}`;
  } else if (query.metadata?.name) {
    return query.metadata.name;
  } else {
    return path.basename(query.program.queryPath);
  }
}


/**
 * Call cli command to interpret SARIF results.
 */
export async function interpretSarifResults(
  server: cli.CodeQLCliServer,
  metadata: QueryMetadata | undefined,
  resultsPaths: ResultsPaths,
  sourceInfo?: cli.SourceInfo
): Promise<SarifInterpretationData> {
  const { resultsPath, interpretedResultsPath } = resultsPaths;
  if (await fs.pathExists(interpretedResultsPath)) {
    return { ...JSON.parse(await fs.readFile(interpretedResultsPath, 'utf8')), t: 'SarifInterpretationData' };
  }
  if (metadata === undefined) {
    throw new Error('Can\'t interpret results without query metadata');
  }
  let { kind, id } = metadata;
  if (kind === undefined) {
    throw new Error('Can\'t interpret results without query metadata including kind');
  }
  if (id === undefined) {
    // Interpretation per se doesn't really require an id, but the
    // SARIF format does, so in the absence of one, we use a dummy id.
    id = 'dummy-id';
  }
  const additionalArgs = [
    // TODO: This flag means that we don't group interpreted results
    // by primary location. We may want to revisit whether we call
    // interpretation with and without this flag, or do some
    // grouping client-side.
    '--no-group-results'
  ];

  await server.interpretBqrs({ kind, id }, SARIF_FORMAT, additionalArgs, resultsPath, interpretedResultsPath, sourceInfo);

  let output: string;
  try {
    output = await fs.readFile(interpretedResultsPath, 'utf8');
  } catch (err) {
    throw new Error(`Reading output of interpretation failed: ${err.stderr || err}`);
  }

  try {
    return { ...JSON.parse(output) as sarif.Log, t: 'SarifInterpretationData' };
  } catch (err) {
    throw new Error(`Parsing output of interpretation failed: ${err.stderr || err}`);
  }
}


/**
 * Call cli command to interpret graph results.
 */
export async function interpretGraphResults(
  server: cli.CodeQLCliServer,
  metadata: QueryMetadata | undefined,
  resultsPaths: ResultsPaths,
  sourceInfo?: cli.SourceInfo
): Promise<GraphInterpretationData> {
  const { resultsPath, interpretedResultsPath } = resultsPaths;
  if (await fs.pathExists(interpretedResultsPath)) {
    const dot = await fs.readFile(interpretedResultsPath, 'utf8');
    return { dot, t: 'GraphInterpretationData' };
  }
  if (metadata === undefined) {
    throw new Error('Can\'t interpret results without query metadata');
  }
  let { kind, id } = metadata;
  if (kind === undefined) {
    throw new Error('Can\'t interpret results without query metadata including kind');
  }
  if (id === undefined) {
    // Interpretation per se doesn't really require an id, but the
    // SARIF format does, so in the absence of one, we use a dummy id.
    id = 'dummy-id';
  }

  const additionalArgs = sourceInfo ? ['--dot-location-url-format', 'file://' + sourceInfo.sourceLocationPrefix + '{path}:{start:line}:{start:column}:{end:line}:{end:column}'] : [];

  await server.interpretBqrs({ kind, id }, 'dot', additionalArgs, resultsPath, interpretedResultsPath, sourceInfo);

  try {
    const dot = await fs.readFile(path.join(interpretedResultsPath, id + '.dot'), 'utf8');
    return { dot, t: 'GraphInterpretationData' };
  } catch (err) {
    throw new Error(`Reading output of interpretation failed: ${err.stderr || err}`);
  }
}
