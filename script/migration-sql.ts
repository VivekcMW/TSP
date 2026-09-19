/** Limited PostgreSQL lexical splitter, not a SQL grammar validator.
 * Literals, identifiers, nested comments and dollar bodies are opaque.
 * Requires standard_conforming_strings=on; SQL bodies must be quoted.
 */
type Token = { text: string; start: number; end: number };
export type SqlStatement = { tokens: Token[] };

function skipBlockComment(sql: string, start: number): number {
  let depth = 1;
  let i = start + 2;
  while (i < sql.length && depth) {
    if (sql.startsWith("/*", i)) { depth++; i += 2; }
    else if (sql.startsWith("*/", i)) { depth--; i += 2; }
    else i++;
  }
  if (depth) throw new Error("Unterminated SQL comment");
  return i;
}

function skipTrivia(sql: string, start: number): number {
  let i = start;
  while (i < sql.length) {
    if (/[ \t\n\r\f\v]/.test(sql[i])) { i++; continue; }
    if (sql.startsWith("--", i)) {
      while (i < sql.length && sql[i] !== "\n" && sql[i] !== "\r") i++;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      i = skipBlockComment(sql, i);
      continue;
    }
    break;
  }
  return i;
}

function quotedEnd(sql: string, start: number, escaped: boolean): number {
  const quote = sql[start];
  let i = start + 1;
  while (i < sql.length) {
    if (escaped && sql[i] === "\\") { i += 2; continue; }
    if (sql[i++] !== quote) continue;
    if (sql[i] === quote) { i++; continue; }
    return i;
  }
  throw new Error("Unterminated SQL quote");
}

function stringEnd(sql: string, start: number, escaped: boolean): number {
  let end = quotedEnd(sql, start, escaped);
  // PostgreSQL newline-separated strings continue the SAME escape mode.
  while (sql[start] === "'") {
    const next = skipTrivia(sql, end);
    if (sql[next] !== "'" || !/[\r\n]/.test(sql.slice(end, next))) break;
    end = quotedEnd(sql, next, escaped);
  }
  return end;
}

function nextToken(sql: string, start: number): Token {
  const c = sql[start];
  const escaped = (c === "e" || c === "E") && sql[start + 1] === "'";
  if (c === "'" || c === '"' || escaped) {
    return { start, end: stringEnd(sql, start + (escaped ? 1 : 0), escaped), text: "<quoted>" };
  }
  const delimiter = c === "$" ? /^\$(?:[A-Za-z_\u0080-\uffff][A-Za-z_0-9\u0080-\uffff]*)?\$/u.exec(sql.slice(start))?.[0] : undefined;
  if (delimiter) {
    const end = sql.indexOf(delimiter, start + delimiter.length);
    if (end < 0) throw new Error("Unterminated SQL dollar quote");
    return { start, end: end + delimiter.length, text: "<quoted>" };
  }
  let end = start + 1;
  if (/[A-Za-z_\u0080-\uffff]/u.test(c)) {
    while (end < sql.length && /[A-Za-z_0-9$\u0080-\uffff]/u.test(sql[end])) end++;
  }
  return { start, end, text: sql.slice(start, end).toUpperCase() };
}

export function splitSqlStatements(sql: string): SqlStatement[] {
  const statements: SqlStatement[] = [];
  let tokens: Token[] = [];
  let i = skipTrivia(sql, 0);
  while (i < sql.length) {
    const token = nextToken(sql, i);
    if (token.text === ";") {
      if (tokens.length) { tokens.push(token); statements.push({ tokens }); tokens = []; }
    } else tokens.push(token);
    i = skipTrivia(sql, token.end);
  }
  if (tokens.length) statements.push({ tokens });
  return statements;
}

function words(statement: SqlStatement): string[] {
  return statement.tokens.filter(t => t.text !== ";").map(t => t.text);
}
const openControls = new Set(["BEGIN", "BEGIN WORK", "BEGIN TRANSACTION", "START TRANSACTION"]);
const closeControls = new Set(["COMMIT", "COMMIT WORK", "COMMIT TRANSACTION", "END", "END WORK", "END TRANSACTION"]);
const controlHeads = new Set(["BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"]);

export function normalizeMigrationSql(sql: string, allowHistoricalTerminalCommit = false) {
  const statements = splitSqlStatements(sql);
  const removed = new Set<SqlStatement>();
  const first = statements[0];
  const last = statements.at(-1);
  if (first && last && first !== last && openControls.has(words(first).join(" ")) && closeControls.has(words(last).join(" "))) {
    removed.add(first); removed.add(last);
  } else if (allowHistoricalTerminalCommit && last && words(last).join(" ") === "COMMIT") {
    removed.add(last);
  }
  for (const statement of statements) {
    if (removed.has(statement)) continue;
    const w = words(statement);
    if (controlHeads.has(w[0]) || (w[0] === "PREPARE" && w[1] === "TRANSACTION") ||
        (w[0] === "SET" && (w.includes("TRANSACTION") || w.includes("CHARACTERISTICS")))) {
      throw new Error("Unexpected transaction control; only one plain outer BEGIN/COMMIT pair is supported");
    }
    if (w[0] === "COPY" || w[0] === "CALL" || w[0] === "\\" ||
        ((w[0] === "SET" || w[0] === "RESET") && w.some(v => ["STANDARD_CONFORMING_STRINGS", "ALL", "<quoted>"].includes(v))) ||
        w.some((v, index) => v === "BEGIN" && w[index + 1] === "ATOMIC")) {
      throw new Error("Unsupported migration lexical/session control");
    }
  }
  // Blank control tokens only; preserve every comment, literal and body byte.
  const ranges = [...removed].flatMap(s => s.tokens).sort((a, b) => a.start - b.start);
  let cursor = 0;
  let normalized = "";
  for (const range of ranges) {
    normalized += sql.slice(cursor, range.start) + " ".repeat(range.end - range.start);
    cursor = range.end;
  }
  normalized += sql.slice(cursor);
  return { sql: normalized, statementCount: statements.length - removed.size, removedControls: removed.size };
}