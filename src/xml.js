'use strict';
// Just enough XML for Tally-format messages: elements, attributes and text.
// No namespaces, DTDs or CDATA sections.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

// Control characters sent as references (Tally uses &#4;) are dropped.
const decode = (text) => text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (whole, ref) => {
  if (ref[0] !== '#') return ENTITIES[ref] ?? whole;
  const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
  return code < 32 && ![9, 10, 13].includes(code) ? '' : String.fromCodePoint(code);
});

const escape = (value) => String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// Returns a root node whose children are the document's top-level elements.
// A node is { name, attrs, children, text }.
function parse(source) {
  const root = { name: '', attrs: {}, children: [], text: '' };
  const stack = [root];
  const token = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/([^\s>]+)\s*>|<([^\s/>!?]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (const match of String(source).matchAll(token)) {
    const [, closing, opening, attributes, selfClosing, text] = match;
    if (closing) {
      if (stack.length > 1) stack.pop();
    } else if (opening) {
      const node = { name: opening, attrs: {}, children: [], text: '' };
      for (const [, key, double, single] of attributes.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[key] = decode(double ?? single);
      stack.at(-1).children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (text) {
      stack.at(-1).text += decode(text);
    }
  }
  return root;
}

// Every descendant with that name, in document order.
const all = (node, name) => node.children.flatMap((child) => [...(child.name === name ? [child] : []), ...all(child, name)]);
// The trimmed text of the first child with that name, or ''.
const text = (node, name) => (node.children.find((child) => child.name === name)?.text ?? '').trim();

module.exports = { parse, all, text, escape };
