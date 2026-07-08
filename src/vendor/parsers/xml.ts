// Vendored from covallaby/covallaby (parsers/src/xml.ts) until packages publish to npm. Do not edit here.
import { XMLParser } from "fast-xml-parser";
import { ParseError } from "./lcov.js";

/** Parse XML into fast-xml-parser's object shape, with friendly failure. */
export function parseXml(content: string, what: string): Record<string, unknown> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    ignoreDeclaration: true,
    processEntities: true,
  });
  try {
    return parser.parse(content) as Record<string, unknown>;
  } catch {
    throw new ParseError(`This doesn't look like valid ${what} XML.`);
  }
}

/** fast-xml-parser yields a single object for one child, an array for many. */
export function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function attr(node: unknown, name: string): string | undefined {
  if (typeof node !== "object" || node === null) return undefined;
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return value === undefined ? undefined : String(value);
}

export function intAttr(node: unknown, name: string): number {
  const raw = attr(node, name);
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
}
