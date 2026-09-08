import type { DatasetCatalogEntry } from "../../utils/api";
export const DATASET_DOMAINS = {
  bci: ["脑机接口", "Brain–computer interfaces"],
  cognition: ["注意与认知控制", "Attention & cognitive control"],
  learning: ["学习与决策", "Learning & decision making"],
  memory: ["记忆与空间导航", "Memory & navigation"],
  language: ["语言与自然刺激", "Language & natural stimuli"],
  sensory: ["感觉与表征", "Sensation & representation"],
  motor: ["运动与康复", "Movement & rehabilitation"],
  sleep: ["睡眠", "Sleep"],
  clinical: ["临床神经科学", "Clinical neuroscience"],
  lifespan: ["发育与衰老", "Development & aging"],
  circuits: ["细胞群体与环路", "Cell populations & circuits"],
  molecular: ["细胞图谱与组学", "Cell atlases & omics"],
  connectivity: ["脑连接", "Brain connectivity"],
  physiology: ["生理信号", "Physiology"],
  methods: ["分析方法与教学", "Methods & tutorials"],
} as const;
export function domainLabel(domain: string, chinese: boolean): string {
  return DATASET_DOMAINS[domain as keyof typeof DATASET_DOMAINS]?.[chinese ? 0 : 1] ?? domain;
}
export function matchesDataset(entry: DatasetCatalogEntry, query: string): boolean {
  const text = [entry.id, entry.name, entry.summary, entry.summaryZh, entry.description, entry.provider,
    entry.license, entry.species, ...entry.modalities, ...(entry.formats ?? []), ...(entry.tasks ?? []),
    ...(entry.domains ?? []).flatMap((domain) => [domainLabel(domain, true), domainLabel(domain, false)]),
    ...(entry.researchQuestions ?? []).flatMap((question) => [question.en, question.zh]),
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean).every((term) => text.includes(term));
}
