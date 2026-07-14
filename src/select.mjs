// Conversation selection over the merged store. Pure over the store; the CLI
// calls refresh() first to pull in fresh Codex sessions.
import { readIndex, readConversation } from './store.mjs';
import { pathRelated } from './paths.mjs';
import { importRecentCodex } from './codex-import.mjs';

// Pull recent Codex rollouts for this project into the store, then return index.
export function refresh(project) {
  try {
    importRecentCodex(project);
  } catch {
    /* never let a Codex scan break a pickup */
  }
  return readIndex();
}

export function list({ project } = {}) {
  let idx = readIndex();
  if (project) idx = idx.filter((e) => pathRelated(e.project, project));
  return idx.map((e, i) => ({
    n: i + 1,
    id: e.id,
    source: e.source,
    title: e.title || '(untitled)',
    updated: e.updated,
    project: e.project,
  }));
}

// Resolve to one conversation. Priority: explicit id > 1-based index in project >
// newest in project > newest overall.
export function pick({ project, id, index } = {}) {
  if (id) return readConversation(id);
  const inProject = list({ project });
  let chosen = null;
  if (index != null && Number.isInteger(index) && index >= 1 && index <= inProject.length) {
    chosen = inProject[index - 1];
  } else if (inProject.length) {
    chosen = inProject[0];
  } else if (project) {
    const all = list({});
    chosen = all[0] || null; // fall back to newest overall if nothing matches project
  }
  return chosen ? readConversation(chosen.id) : null;
}
