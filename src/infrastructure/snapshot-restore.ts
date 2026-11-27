// The RLIDB001 reader checks the descriptor against the original row. Follow
// only own properties of that projection, never a prototype or accessor.
type Path = (string | number)[];
type Row = Record<string | number, unknown>;

function own(parent: unknown, key: string | number): unknown {
  if (
    parent === null ||
    typeof parent !== 'object' ||
    (Array.isArray(parent)
      ? !Number.isSafeInteger(key)
      : typeof key !== 'string') ||
    !Object.hasOwn(parent, key)
  )
    throw new Error('克隆描述的路径未指向已有自有字段。');
  return (parent as Row)[key];
}

export function restoreSnapshotValue(
  projectionJson: string,
  descriptorJson: string,
): unknown {
  const root: unknown = JSON.parse(projectionJson);
  const descriptor: {
    version: number;
    objects: { path: Path; keys: string[]; undefinedKeys: string[] }[];
    aliases: { path: Path; target: Path }[];
  } = JSON.parse(descriptorJson);
  if (
    descriptor.version !== 1 ||
    !Array.isArray(descriptor.objects) ||
    !Array.isArray(descriptor.aliases)
  )
    throw new Error('克隆描述版本或成员无效。');
  const at = (path: Path) => {
    if (!Array.isArray(path) || path.length > 64)
      throw new Error('克隆描述路径无效。');
    return path.reduce<unknown>(own, root);
  };
  for (const patch of descriptor.objects) {
    const parent = at(patch.path);
    if (!parent || typeof parent !== 'object' || Array.isArray(parent))
      throw new Error('显式 undefined 的父对象无效。');
    const present = new Map(Object.entries(parent));
    const missing = new Set(patch.undefinedKeys);
    for (const key of present.keys()) delete (parent as Row)[key];
    for (const key of patch.keys) {
      if (!missing.has(key) && !present.has(key))
        throw new Error('克隆描述缺少原字段。');
      Object.defineProperty(parent, key, {
        value: missing.has(key) ? undefined : present.get(key),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  for (const alias of descriptor.aliases) {
    const key = alias.path.at(-1);
    const parent = at(alias.path.slice(0, -1));
    if (key === undefined) throw new Error('共享引用路径为空。');
    own(parent, key);
    const target = at(alias.target);
    if (!target || typeof target !== 'object')
      throw new Error('共享引用目标无效。');
    Object.defineProperty(parent, key, {
      value: target,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return root;
}
