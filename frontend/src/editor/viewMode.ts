/**
 * 只读模式开关：/view 页在挂载前置 true，编辑器 store 据此忽略本机 localStorage 存档，
 * 强制以服务器稿（带凭证拉取）为准。普通编辑器路径不受影响。
 */
export const viewServerOnly = { on: false }
