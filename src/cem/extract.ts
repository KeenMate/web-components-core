/**
 * Read a BlissElement's `static inputs` / `static events` tables from the
 * TypeScript AST and turn them into Custom Elements Manifest data (SPEC §12.4).
 * This is the source-of-truth split in action: the tables give the STRUCTURE
 * (attribute↔property mapping, type, default, reflect), while `description` /
 * `deprecated` on each row give the PROSE. Pure — it takes the `ts` API and a
 * `SourceFile`, so it is unit-testable with the `typescript` package alone; the
 * analyzer plugin ({@link ./plugin}) is a thin wrapper that feeds these results
 * into the manifest.
 */
import type * as TsNamespace from 'typescript';

type TS = typeof import('typescript');
type Node = TsNamespace.Node;
type Expression = TsNamespace.Expression;
type SourceFile = TsNamespace.SourceFile;
type ObjectLiteralExpression = TsNamespace.ObjectLiteralExpression;

export interface ExtractedType {
  text: string;
}

export interface ExtractedAttribute {
  name: string;
  fieldName?: string;
  type?: ExtractedType;
  default?: string;
  description?: string;
  deprecated?: string | boolean;
}

export interface ExtractedMember {
  kind: 'field';
  name: string;
  privacy: 'public';
  type?: ExtractedType;
  default?: string;
  attribute?: string;
  reflects?: boolean;
  description?: string;
  deprecated?: string | boolean;
}

export interface ExtractedEvent {
  name: string;
  description?: string;
  deprecated?: string | boolean;
}

export interface ExtractedClass {
  name: string;
  attributes: ExtractedAttribute[];
  members: ExtractedMember[];
  events: ExtractedEvent[];
}

/** Peel `(expr)`, `expr as T`, `expr satisfies T` down to the underlying expression. */
function unwrap(ts: TS, expr: Expression): Expression {
  let e = expr;
  while (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    (ts.isSatisfiesExpression && ts.isSatisfiesExpression(e))
  ) {
    e = e.expression;
  }
  return e;
}

/** The static text name of a property/identifier name node, if it is a plain name. */
function nameOf(ts: TS, name: TsNamespace.PropertyName | TsNamespace.BindingName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return undefined;
}

/** The initializer of property `key` on an object literal, if present. */
function propOf(ts: TS, obj: ObjectLiteralExpression, key: string): Expression | undefined {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && nameOf(ts, p.name) === key) return p.initializer;
  }
  return undefined;
}

function stringOf(ts: TS, expr: Expression | undefined): string | undefined {
  return expr && ts.isStringLiteralLike(expr) ? expr.text : undefined;
}

function boolOf(ts: TS, expr: Expression | undefined): boolean | undefined {
  if (!expr) return undefined;
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
  return undefined;
}

/** `deprecated` may be `true`/`false` or a reason string. */
function deprecatedOf(ts: TS, obj: ObjectLiteralExpression): string | boolean | undefined {
  const e = propOf(ts, obj, 'deprecated');
  if (!e) return undefined;
  const b = boolOf(ts, e);
  if (b !== undefined) return b;
  return stringOf(ts, e);
}

/** A leading `/** … *\/` or `//` comment on a node, flattened to one line. */
function leadingComment(ts: TS, node: Node, sf: SourceFile): string | undefined {
  const full = sf.getFullText();
  const ranges = ts.getLeadingCommentRanges(full, node.getFullStart());
  if (!ranges || ranges.length === 0) return undefined;
  const raw = full.slice(ranges[ranges.length - 1]!.pos, ranges[ranges.length - 1]!.end);
  const cleaned = raw
    .replace(/^\/\*\*?/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*? ?/, '').replace(/^\/\/ ?/, '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return cleaned || undefined;
}

/** Description from the row's `description` property, else a leading comment. */
function descriptionOf(ts: TS, obj: ObjectLiteralExpression, node: Node, sf: SourceFile): string | undefined {
  return stringOf(ts, propOf(ts, obj, 'description')) ?? leadingComment(ts, node, sf);
}

/** Follow an identifier to its `const NAME = […]` initializer within the same file; unwrap `as const`. */
function resolveArrayLiteral(
  ts: TS,
  expr: Expression,
  sf: SourceFile,
): TsNamespace.ArrayLiteralExpression | undefined {
  const e = unwrap(ts, expr);
  if (ts.isArrayLiteralExpression(e)) return e;
  if (ts.isIdentifier(e)) {
    const target = e.text;
    for (const stmt of sf.statements) {
      if (!ts.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (nameOf(ts, decl.name) === target && decl.initializer) {
          const init = unwrap(ts, decl.initializer);
          if (ts.isArrayLiteralExpression(init)) return init;
        }
      }
    }
  }
  return undefined;
}

/** Derive a TS type string from a `to*` converter call expression. */
function typeFromConverter(ts: TS, expr: Expression | undefined): ExtractedType | undefined {
  if (!expr) return undefined;
  const call = unwrap(ts, expr);
  if (!ts.isCallExpression(call) || !ts.isIdentifier(call.expression)) return undefined;
  const name = call.expression.text;
  const args = call.arguments;
  switch (name) {
    case 'toEnum': {
      const arr = args[0];
      if (arr && ts.isArrayLiteralExpression(arr)) {
        const members = arr.elements
          .map((el) => stringOf(ts, el))
          .filter((v): v is string => v !== undefined)
          .map((v) => `'${v}'`);
        if (members.length) return { text: members.join(' | ') };
      }
      return { text: 'string' };
    }
    case 'toInt':
    case 'toFloat':
    case 'toBytes':
      return { text: 'number' };
    case 'toText': {
      const opts = args[0];
      const nullable = opts && ts.isObjectLiteralExpression(opts) && boolOf(ts, propOf(ts, opts, 'isNullable')) === true;
      return { text: nullable ? 'string | null' : 'string' };
    }
    case 'toBool': {
      const mode = stringOf(ts, args[0]);
      return { text: mode === 'tristate' ? 'boolean | null' : 'boolean' };
    }
    case 'toList':
      return { text: 'string[]' };
    case 'toObjectArray':
      return { text: 'unknown[]' };
    case 'toObject':
      return { text: 'object' };
    case 'toValue':
      return { text: 'unknown' };
    case 'toFunction':
      return { text: 'Function' };
    case 'toCustom':
      return { text: 'unknown' };
    default:
      return undefined;
  }
}

/** The default value's source text: the row's `default`, else the converter's `default` option. */
function defaultText(ts: TS, row: ObjectLiteralExpression, converter: Expression | undefined, sf: SourceFile): string | undefined {
  const rowDefault = propOf(ts, row, 'default');
  if (rowDefault) return rowDefault.getText(sf);
  if (converter) {
    const call = unwrap(ts, converter);
    if (ts.isCallExpression(call)) {
      for (const arg of call.arguments) {
        if (ts.isObjectLiteralExpression(arg)) {
          const d = propOf(ts, arg, 'default');
          if (d) return d.getText(sf);
        }
      }
    }
  }
  return undefined;
}

/** Turn one `InputDef` row object literal into an attribute (if any) + a member. */
function extractInput(
  ts: TS,
  row: ObjectLiteralExpression,
  sf: SourceFile,
): { attribute?: ExtractedAttribute; member?: ExtractedMember } {
  const configKey = stringOf(ts, propOf(ts, row, 'configKey'));
  if (!configKey) return {};
  const attribute = stringOf(ts, propOf(ts, row, 'attribute'));
  const converter = propOf(ts, row, 'converter');
  const type = typeFromConverter(ts, converter);
  const def = defaultText(ts, row, converter, sf);
  const reflects = boolOf(ts, propOf(ts, row, 'reflect')) === true;
  const description = descriptionOf(ts, row, row, sf);
  const deprecated = deprecatedOf(ts, row);

  const member: ExtractedMember = {
    kind: 'field',
    name: configKey,
    privacy: 'public',
    ...(type ? { type } : {}),
    ...(def !== undefined ? { default: def } : {}),
    ...(attribute ? { attribute } : {}),
    ...(reflects ? { reflects: true } : {}),
    ...(description ? { description } : {}),
    ...(deprecated !== undefined ? { deprecated } : {}),
  };

  if (!attribute) return { member };

  const attr: ExtractedAttribute = {
    name: attribute,
    fieldName: configKey,
    ...(type ? { type } : {}),
    ...(def !== undefined ? { default: def } : {}),
    ...(description ? { description } : {}),
    ...(deprecated !== undefined ? { deprecated } : {}),
  };
  return { attribute: attr, member };
}

/** Turn one `static events` entry (bare string or `EventDef`) into an event. */
function extractEvent(ts: TS, entry: Expression, sf: SourceFile): ExtractedEvent | undefined {
  const bare = stringOf(ts, entry);
  if (bare) return { name: bare };
  if (ts.isObjectLiteralExpression(entry)) {
    const name = stringOf(ts, propOf(ts, entry, 'name'));
    if (!name) return undefined;
    const description = descriptionOf(ts, entry, entry, sf);
    const deprecated = deprecatedOf(ts, entry);
    return { name, ...(description ? { description } : {}), ...(deprecated !== undefined ? { deprecated } : {}) };
  }
  return undefined;
}

/** The initializer of a `static <name>` property on a class, if present. */
function staticMember(ts: TS, cls: TsNamespace.ClassDeclaration, name: string): Expression | undefined {
  for (const member of cls.members) {
    if (
      ts.isPropertyDeclaration(member) &&
      member.modifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) &&
      nameOf(ts, member.name) === name &&
      member.initializer
    ) {
      return member.initializer;
    }
  }
  return undefined;
}

/** Extract manifest data for one class that declares `static inputs` and/or `static events`. */
export function extractBlissClass(ts: TS, cls: TsNamespace.ClassDeclaration, sf: SourceFile): ExtractedClass | undefined {
  if (!cls.name) return undefined;
  const inputsInit = staticMember(ts, cls, 'inputs');
  const eventsInit = staticMember(ts, cls, 'events');
  if (!inputsInit && !eventsInit) return undefined; // not a table-driven component

  const attributes: ExtractedAttribute[] = [];
  const members: ExtractedMember[] = [];
  const events: ExtractedEvent[] = [];

  if (inputsInit) {
    const arr = resolveArrayLiteral(ts, inputsInit, sf);
    for (const el of arr?.elements ?? []) {
      const row = unwrap(ts, el);
      if (!ts.isObjectLiteralExpression(row)) continue;
      const { attribute, member } = extractInput(ts, row, sf);
      if (attribute) attributes.push(attribute);
      if (member) members.push(member);
    }
  }

  if (eventsInit) {
    const arr = resolveArrayLiteral(ts, eventsInit, sf);
    for (const el of arr?.elements ?? []) {
      const event = extractEvent(ts, unwrap(ts, el), sf);
      if (event) events.push(event);
    }
  }

  return { name: cls.name.text, attributes, members, events };
}

/** Extract every table-driven component class in a source file. */
export function extractBlissClasses(ts: TS, sf: SourceFile): ExtractedClass[] {
  const out: ExtractedClass[] = [];
  const visit = (node: Node): void => {
    if (ts.isClassDeclaration(node)) {
      const meta = extractBlissClass(ts, node, sf);
      if (meta) out.push(meta);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
