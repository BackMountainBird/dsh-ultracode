/**
 * The composer ULTRA chip's dictionary keys (namespace `ultra`).
 * @module dsh-ultra/client/locales
 */

/** Locale keys owned by the `ultra` namespace. */
export type UltraKey =
  | 'chip.off.label'
  | 'chip.off.aria'
  | 'chip.off.title'
  | 'chip.on.aria'
  | 'chip.on.title'

/** English dictionary. */
export const en: Record<UltraKey, string> = {
  'chip.off.label': 'Ultra',
  'chip.off.aria': 'Switch this session to ultra mode (pinned max effort and orchestration policy)',
  'chip.off.title': 'Ultra mode: pin max effort and activate the orchestration policy',
  'chip.on.aria': 'Leave ultra mode',
  'chip.on.title': 'Ultra mode is on — click to leave',
}

/** Simplified-Chinese dictionary. */
export const zh: Record<UltraKey, string> = {
  'chip.off.label': 'Ultra',
  'chip.off.aria': '将本会话切换到 ultra 模式（锁定最高推理强度并启用编排策略）',
  'chip.off.title': 'Ultra 模式：锁定最高推理强度并启用编排策略',
  'chip.on.aria': '退出 ultra 模式',
  'chip.on.title': 'Ultra 模式已开启——点击退出',
}
