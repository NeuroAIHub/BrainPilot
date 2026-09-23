import { describe, expect, it } from "vitest";

import { checkFormattingReferences } from "../workflows/formatting-references.js";

function expectPass(previous: string, candidate: string): void {
  const result = checkFormattingReferences(previous, candidate);
  expect(result.ok).toBe(true);
}

function expectFail(previous: string, candidate: string): void {
  const result = checkFormattingReferences(previous, candidate);
  expect(result.ok).toBe(false);
  expect(result.reasonCodes.length).toBeGreaterThan(0);
}

describe("checkFormattingReferences: preserved citations", () => {
  it("passes identical unknown static keys", () => {
    const doc = String.raw`Text \cite{unknownKey2024} and \cite{another_one}.`;
    expectPass(doc, doc);
  });

  it("passes when key order inside a group changes", () => {
    expectPass(String.raw`\cite{a,b,c}`, String.raw`\cite{c,a,b}`);
  });

  it("passes when the order of citation commands changes", () => {
    expectPass(
      String.raw`\cite{a} then \cite{b}`,
      String.raw`\cite{b} then \cite{a}`,
    );
  });

  it("passes when a key is repeated a different number of times", () => {
    expectPass(
      String.raw`\cite{a} and \cite{b}`,
      String.raw`\cite{a} and \cite{b} and again \cite{a}`,
    );
  });

  it("passes when a plain optional note is added or edited", () => {
    expectPass(String.raw`\cite{a}`, String.raw`\cite[p.~5]{a}`);
    expectPass(String.raw`\cite[p.~5]{a}`, String.raw`\cite[see][p.~7]{a}`);
  });

  it("passes when only the bibliography style changes", () => {
    expectPass(
      String.raw`\bibliographystyle{plain}\bibliography{refs}\cite{a}`,
      String.raw`\bibliographystyle{unsrtnat}\bibliography{refs}\cite{a}`,
    );
  });
});

describe("checkFormattingReferences: dropped or altered citations", () => {
  it("fails when a citation key is added", () => {
    expectFail(String.raw`\cite{a}`, String.raw`\cite{a}\cite{b}`);
  });

  it("fails when a citation key is removed", () => {
    expectFail(String.raw`\cite{a,b}`, String.raw`\cite{a}`);
  });

  it("fails when the bibliography resource changes", () => {
    expectFail(
      String.raw`\bibliography{refs}\cite{a}`,
      String.raw`\bibliography{other}\cite{a}`,
    );
    expectFail(
      String.raw`\addbibresource{refs.bib}\cite{a}`,
      String.raw`\addbibresource{other.bib}\cite{a}`,
    );
  });

  it("fails when an external bibliography is replaced by an inline one", () => {
    expectFail(
      String.raw`\bibliography{refs}\cite{a}`,
      String.raw`\cite{a}
\begin{thebibliography}{9}
\bibitem{a} Smith, A. (1998). A Paper.
\end{thebibliography}`,
    );
  });
});

describe("checkFormattingReferences: inline bibitem entries", () => {
  const bibliography = (author: string, year: string): string => String.raw`
\begin{thebibliography}{9}
% a fake \end{thebibliography} hidden inside a percent comment
\bibitem{knuth} Knuth, D. (1984). The TeXbook.
An escaped slash pair \\end{thebibliography} is only text.
Literals \verb|\end{thebibliography}| and \verb*+\end{thebibliography}+.
\begin{verbatim}
\end{thebibliography}
\end{verbatim}
\begin{lstlisting}
\end{thebibliography}
\end{lstlisting}
\bibitem{smith} ${author} (${year}). A Paper.
\end{thebibliography}`;

  it("passes when the entry with decoy end markers is unchanged", () => {
    const doc = bibliography("Smith, A.", "1998");
    expectPass(doc, doc);
  });

  it("fails when the year of an existing bibitem changes", () => {
    expectFail(bibliography("Smith, A.", "1998"), bibliography("Smith, A.", "2003"));
  });

  it("fails when the author of an existing bibitem changes", () => {
    expectFail(bibliography("Smith, A.", "1998"), bibliography("Smythe, B.", "1998"));
  });

  it("passes for an ordinary unchanged inline bibliography", () => {
    const doc = String.raw`\cite{a}
\begin{thebibliography}{9}
\bibitem{a} Adams, C. (2011). Another Paper.
\end{thebibliography}`;
    expectPass(doc, doc);
  });
});

describe("checkFormattingReferences: filecontents bibliographies", () => {
  const filecontents = (year: string): string => String.raw`\begin{filecontents}{refs.bib}
@article{a, author = {Adams, C.}, year = {${year}}}
\end{filecontents}
\bibliography{refs}\cite{a}`;

  it("passes when the embedded bib file is unchanged", () => {
    expectPass(filecontents("2011"), filecontents("2011"));
  });

  it("fails when the embedded bib file changes", () => {
    expectFail(filecontents("2011"), filecontents("2012"));
  });
});

describe("checkFormattingReferences: cite command scanning", () => {
  it("ignores fake cite commands in comments, verb, verbatim and escaped slashes", () => {
    const decoys = String.raw`\cite{a}
% \cite{commented}
\verb|\cite{verbed}| \verb*+\cite{starred}+
\begin{verbatim}
\cite{verbatimed}
\end{verbatim}
An escaped slash pair \\cite{escaped} is only text.`;
    expectPass(String.raw`\cite{a}`, decoys);
    expectPass(decoys, String.raw`\cite{a}`);
  });

  it("treats a third slash before cite as a real citation", () => {
    expectFail(String.raw`\cite{a}`, String.raw`\cite{a} \\\cite{sneaky}`);
  });

  it("allows a comment between the command and its argument", () => {
    expectPass(
      String.raw`\cite{a}`,
      "\\cite%comment eats the newline\n  {a}",
    );
  });

  it("joins an argument split by a comment into a single key", () => {
    const split = "\\cite{A%comment eats the newline\n  B}";
    expectPass(String.raw`\cite{AB}`, split);
    expectFail(String.raw`\cite{A}`, split);
  });
});

describe("checkFormattingReferences: unanalyzable input", () => {
  it("fails on malformed citation groups", () => {
    expectFail(String.raw`\cite{a}`, String.raw`\cite{a`);
    expectFail(String.raw`\cite{a`, String.raw`\cite{a}`);
  });

  it("fails on dynamic citation parameters", () => {
    const doc = String.raw`\newcommand{\key}{a}\cite{\key}`;
    expectFail(doc, doc);
  });

  it("fails on dynamic bibliography parameters", () => {
    const bib = String.raw`\bibliography{\jobname}\cite{a}`;
    expectFail(bib, bib);
    const resource = String.raw`\addbibresource{\jobname.bib}\cite{a}`;
    expectFail(resource, resource);
    const bibParam = String.raw`\bibliography{#1}\cite{a}`;
    expectFail(bibParam, bibParam);
    const resourceParam = String.raw`\addbibresource{#1}\cite{a}`;
    expectFail(resourceParam, resourceParam);
  });

  it("fails when an optional note hides a citation", () => {
    expectFail(
      String.raw`\cite{a}`,
      String.raw`\cite[see also \cite{b}]{a}`,
    );
  });

  it("fails on a brace-and-bracket tangled optional note", () => {
    expectFail(String.raw`\cite{a}`, String.raw`\cite[{note ]{a}}]{b}`);
  });
});
