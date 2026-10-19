import { fields, MAX_COLUMNS, MAX_CSV_CHARS, MAX_DATA_ROWS } from './csv-types';
import type {
  ColumnMapping,
  CsvDocument,
  CsvInspection,
  CsvRecord,
  CsvSettings,
  DataIssue,
} from './csv-types';

/** 严格的分隔符/双引号 CSV；保留物理起始行号，不尝试修复损坏引号。 */
export function parseCsv(text: string, settings: CsvSettings): CsvDocument {
  const issues: DataIssue[] = [];
  const empty: CsvDocument = {
    headers: [],
    records: [],
    issues,
    blankLines: 0,
    truncated: false,
  };
  if (text.length > MAX_CSV_CHARS) {
    issues.push({
      severity: 'error',
      code: 'FILE_LIMIT',
      message: 'CSV 超过 10 Mi 字符上限，请拆分文件。',
    });
    return { ...empty, truncated: true };
  }
  if (![',', ';', '\t'].includes(settings.delimiter)) {
    issues.push({
      severity: 'error',
      code: 'DELIMITER',
      message: '不支持的分隔符。',
    });
    return empty;
  }
  const input = text.replace(/^\uFEFF/, '');
  const records: CsvRecord[] = [];
  let line = 1;
  let startLine = 1;
  let recordStart = 0;
  let cells: string[] = [];
  let cell = '';
  let state: 'bare' | 'quoted' | 'closed' = 'bare';
  let malformed = false;
  let touched = false;
  let blankLines = 0;
  let truncated = false;
  function formatError(message: string) {
    if (!malformed)
      issues.push({
        severity: 'error',
        code: 'CSV_FORMAT',
        line: startLine,
        message,
      });
    malformed = true;
  }
  function finishRecord(raw: string) {
    cells.push(cell);
    if (cells.length === 1 && !touched && !cell.trim()) blankLines++;
    else records.push({ line: startLine, cells, malformed, raw });
    cells = [];
    cell = '';
    state = 'bare';
    malformed = false;
    touched = false;
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const newline = char === '\r' || char === '\n';
    if (state === 'quoted') {
      if (char === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else state = 'closed';
      } else if (newline) {
        cell += '\n';
        if (char === '\r' && input[i + 1] === '\n') i++;
        line++;
      } else cell += char;
    } else if (newline) {
      finishRecord(input.slice(recordStart, i));
      if (char === '\r' && input[i + 1] === '\n') i++;
      line++;
      startLine = line;
      recordStart = i + 1;
      if (records.length > MAX_DATA_ROWS + (settings.hasHeader ? 1 : 0)) {
        truncated = true;
        issues.push({
          severity: 'error',
          code: 'ROW_LIMIT',
          message:
            '超过 50,000 条数据记录，停止解析；请拆分文件，当前结果不完整。',
        });
        break;
      }
    } else if (char === settings.delimiter) {
      cells.push(cell);
      cell = '';
      state = 'bare';
      touched = true;
    } else if (char === '"') {
      touched = true;
      if (state === 'bare' && cell === '') state = 'quoted';
      else {
        formatError('双引号必须从字段开头开始，并以成对引号转义。');
        cell += char;
      }
    } else {
      if (state === 'closed') formatError('结束引号后只能出现分隔符或换行。');
      cell += char;
      if (char.trim()) touched = true;
    }
    if (cells.length >= MAX_COLUMNS || cell.length > 65_536) {
      issues.push({
        severity: 'error',
        code: 'CELL_LIMIT',
        line: startLine,
        message: '字段超过 64 列或单字段超过 65,536 字符，停止解析。',
      });
      truncated = true;
      break;
    }
  }
  if (
    !truncated &&
    (touched || cell.length > 0 || cells.length > 0 || state !== 'bare')
  ) {
    if (state === 'quoted') formatError('双引号未闭合；后续内容无法可靠分行。');
    finishRecord(input.slice(recordStart));
  }
  if (records.length > MAX_DATA_ROWS + (settings.hasHeader ? 1 : 0)) {
    truncated = true;
    if (!issues.some((issue) => issue.code === 'ROW_LIMIT'))
      issues.push({
        severity: 'error',
        code: 'ROW_LIMIT',
        message: '超过 50,000 条数据记录，结果不完整。',
      });
  }
  const header = settings.hasHeader ? records.shift() : undefined;
  const width = header?.cells.length ?? records[0]?.cells.length ?? 0;
  const headers = header
    ? header.cells.map((value) => value.trim())
    : Array.from({ length: width }, (_, index) => `第 ${index + 1} 列`);
  if (header?.malformed)
    issues.push({
      severity: 'error',
      code: 'HEADER_FORMAT',
      line: header.line,
      message: '表头格式损坏，不能可靠映射字段。',
    });
  if (!records.length)
    issues.push({
      severity: 'error',
      code: 'EMPTY_DATA',
      message: '没有数据记录：文件为空、只有空白或只有表头。',
    });
  return { headers, records, issues, blankLines, truncated };
}

const aliases: Record<(typeof fields)[number], string[]> = {
  timestamp: [
    'timestamp',
    'timestamputcms',
    'opentime',
    'time',
    'date',
    'datetime',
    '时间',
    '时间戳',
    '开盘时间',
  ],
  open: ['open', '开盘', '开盘价'],
  high: ['high', '最高', '最高价'],
  low: ['low', '最低', '最低价'],
  close: ['close', '收盘', '收盘价'],
  volume: ['volume', 'vol', '成交量'],
};
export function suggestMapping(
  headers: string[],
  hasHeader: boolean,
): ColumnMapping {
  const names = headers.map((value) =>
    value.toLowerCase().replace(/[\s_-]/g, ''),
  );
  return Object.fromEntries(
    fields.map((field, index) => {
      if (!hasHeader) return [field, index < headers.length ? index : null];
      const matches = names.flatMap((name, i) =>
        aliases[field].includes(name) ? [i] : [],
      );
      return [field, matches.length === 1 ? matches[0] : null];
    }),
  ) as ColumnMapping;
}
export function inspectCsv(text: string, settings: CsvSettings): CsvInspection {
  const document = parseCsv(text, settings);
  return {
    headers: document.headers,
    mapping: suggestMapping(document.headers, settings.hasHeader),
    preview: document.records.slice(0, 5),
    recordCount: document.records.length,
    issues: document.issues.slice(0, 20),
    truncated: document.truncated,
  };
}
