/** Erro de regra de negócio com mensagem pronta para a pessoa usuária. */
export class DomainError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
