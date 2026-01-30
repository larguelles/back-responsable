type TokenMap = {
  forward: Map<string, string>;
  reverse: Map<string, string>;
};

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildTokenMap = (names: string[], prefix: string): TokenMap => {
  const forward = new Map<string, string>();
  const reverse = new Map<string, string>();

  const sorted = [...new Set(names)].sort((a, b) => b.length - a.length);

  sorted.forEach((name, idx) => {
    const token = `${prefix}_${idx + 1}`;
    forward.set(name, token);
    reverse.set(token, name);
  });

  return { forward, reverse };
};

const replaceAllCaseInsensitive = (input: string, from: string, to: string) => {
  const re = new RegExp(escapeRegExp(from), 'gi');
  return input.replace(re, to);
};

export const buildMasking = (args: { categories: string[]; items: string[] }) => {
  const cat = buildTokenMap(args.categories, 'CAT');
  const item = buildTokenMap(args.items, 'ITEM');

  const maskText = (text: string) => {
    let out = text;

    for (const [real, token] of cat.forward.entries())
      out = replaceAllCaseInsensitive(out, real, token);
    for (const [real, token] of item.forward.entries())
      out = replaceAllCaseInsensitive(out, real, token);

    return out;
  };

  const unmaskText = (text: string) => {
    let out = text;

    for (const [token, real] of cat.reverse.entries())
      out = replaceAllCaseInsensitive(out, token, real);
    for (const [token, real] of item.reverse.entries())
      out = replaceAllCaseInsensitive(out, token, real);

    return out;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unmaskPlan = <T extends Record<string, any>>(plan: T): T => {
    const clone = structuredClone(plan);

    const unmaskMaybe = (s: unknown) => (typeof s === 'string' ? unmaskText(s) : s);

    if (clone?.filters) {
      if ('categoryName' in clone.filters)
        clone.filters.categoryName = unmaskMaybe(clone.filters.categoryName);
      if ('itemName' in clone.filters) clone.filters.itemName = unmaskMaybe(clone.filters.itemName);

      if (clone.filters.match && typeof clone.filters.match === 'object') {
        clone.filters.match.value = unmaskMaybe(clone.filters.match.value);
      }
    }

    if (clone?.kind === 'forecast' && clone.target?.filters) {
      const f = clone.target.filters;
      if ('categoryName' in f) f.categoryName = unmaskMaybe(f.categoryName);
      if ('itemName' in f) f.itemName = unmaskMaybe(f.itemName);
      if (f.match && typeof f.match === 'object') f.match.value = unmaskMaybe(f.match.value);
    }

    return clone;
  };

  return { maskText, unmaskText, unmaskPlan };
};
