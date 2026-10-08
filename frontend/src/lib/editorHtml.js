export function linkifyHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html"),
    walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT),
    nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest("a")) continue;
    const text = node.textContent,
      regex = /https?:\/\/[^\s<>"']+/g,
      fragment = doc.createDocumentFragment();
    let start = 0,
      match;
    while ((match = regex.exec(text))) {
      fragment.appendChild(doc.createTextNode(text.slice(start, match.index)));
      const link = doc.createElement("a");
      link.setAttribute("href", match[0]);
      link.appendChild(doc.createTextNode(match[0]));
      fragment.appendChild(link);
      start = regex.lastIndex;
    }
    if (start) {
      fragment.appendChild(doc.createTextNode(text.slice(start)));
      node.replaceWith(fragment);
    }
  }
  return doc.body.innerHTML;
}

export function cleanEditorHtml(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const allowed = new Set([
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "S",
    "P",
    "DIV",
    "SPAN",
    "BR",
    "A",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE",
    "TABLE",
    "TR",
    "TD",
    "TH",
    "TBODY",
    "THEAD",
    "HR",
    "FONT",
  ]);
  [...doc.body.querySelectorAll("*")].reverse().forEach((node) => {
    if (
      [
        "SCRIPT",
        "STYLE",
        "IMG",
        "IFRAME",
        "OBJECT",
        "EMBED",
        "SVG",
        "FORM",
        "INPUT",
        "LINK",
        "META",
      ].includes(node.tagName)
    ) {
      node.remove();
      return;
    }
    if (!allowed.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    for (const attribute of [...node.attributes]) {
      if (
        attribute.name === "href" &&
        node.tagName === "A" &&
        /^(https?:|mailto:)/i.test(attribute.value)
      )
        continue;
      if (attribute.name === "style") {
        const styles = attribute.value
          .split(";")
          .filter(
            (v) =>
              /^\s*(font-family|font-size|font-weight|font-style|text-decoration|text-align|color|background-color)\s*:/i.test(
                v,
              ) && !/url|expression|[<>]/i.test(v),
          )
          .join(";");
        node.setAttribute("style", styles);
        continue;
      }
      node.removeAttribute(attribute.name);
    }
  });
  return doc.body.innerHTML;
}
