const STRING_LITERAL = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gsu;
const URL_TOKEN = /(?:https?:)?(?:\/|\\\/){2}[^\s"'`\\<>(){},;]+/giu;
const EXPLICIT_URL_TOKEN = /https?:(?:\/|\\\/){2}[^\s"'`\\<>(){},;]+/giu;
const NETWORK_URL_TOKEN = /(?<![:\/\\])(?:\/|\\\/){2}(?:(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+|localhost)(?::[0-9]{1,5})?(?:\/|\\\/)?[^\s"'`\\<>(){},;]*/giu;

export function externalUrlLiterals(source) {
  const literals = new Set();
  for (const match of source.matchAll(EXPLICIT_URL_TOKEN)) literals.add(match[0].replaceAll("\\/", "/"));
  for (const match of source.matchAll(NETWORK_URL_TOKEN)) literals.add(match[0].replaceAll("\\/", "/"));
  for (const string of source.matchAll(STRING_LITERAL)) {
    if (string[0].length > 4096) continue;
    for (const match of string[0].slice(1, -1).matchAll(URL_TOKEN)) literals.add(match[0].replaceAll("\\/", "/"));
  }
  return literals;
}
