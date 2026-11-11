import { useEffect, useRef, useState } from 'react';
import { RuleStore } from '../infrastructure/rule-store';
import type { RuleRecord } from '../core/rule-library';
import { storageMessage } from '../infrastructure/dataset-store';

export function useRuleLibrary() {
  const store = useRef(new RuleStore());
  const [records, setRecords] = useState<RuleRecord[]>([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const generation = useRef({ value: 0 });
  useEffect(() => {
    let active = true;
    const lifetime = generation.current;
    store.current
      .list()
      .then((list) => {
        if (active) setRecords(list);
      })
      .catch((e) => {
        if (active) setError(storageMessage(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      lifetime.value++;
    };
  }, []);
  async function perform(action: () => Promise<void>, message: string) {
    const token = ++generation.current.value;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      const list = await store.current.list();
      if (token !== generation.current.value) return false;
      setRecords(list);
      setMessage(message);
      return true;
    } catch (e) {
      if (token === generation.current.value)
        setError(
          `策略版本未保存或删除：${storageMessage(e)} 同家族同版本不可覆盖，库上限100版本。可导出JSON备份。`,
        );
      return false;
    } finally {
      if (token === generation.current.value) setBusy(false);
    }
  }
  return {
    records,
    busy,
    error,
    message,
    save: (r: RuleRecord) =>
      perform(
        () => store.current.save(r),
        '策略版本已保存（事务已完成）。请导出JSON备份。',
      ),
    remove: (id: string) =>
      perform(
        () => store.current.delete(id),
        '指定策略版本已删除；已运行实验内嵌的规则不受影响。',
      ),
  };
}
