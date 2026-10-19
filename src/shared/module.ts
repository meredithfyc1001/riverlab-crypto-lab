/** Phase 0 仅声明模块职责；不表示业务能力已实现。 */
export interface ModuleBoundary {
  readonly id: string;
  readonly label: string;
  readonly responsibility: string;
}
