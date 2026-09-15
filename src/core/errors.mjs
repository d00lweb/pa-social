// Article refusé par un garde-fou : bloqué définitivement, une seule alerte
export class GuardError extends Error {
  constructor(article, problems) {
    super(`⛔ Publication bloquée\n${article.title}\n${article.link}\n\n${problems.map((p) => `• ${p}`).join('\n')}`);
    this.name = 'GuardError';
    this.problems = problems;
  }
}

// Publication impossible pour l'instant (quota…) : reportée, sans compter comme un échec
export class DeferError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeferError';
  }
}
