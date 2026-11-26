import { useLibraryList } from './useLibraryList';
import { useEffect, useRef, useState } from 'react';
import { RuleStore } from '../infrastructure/rule-store';
import type { RuleRecord } from '../core/rule-library';
import { storageMessage } from '../infrastructure/dataset-store';

export function useRuleLibrary() {
  const store = useRef(new RuleStore());
  const list = useLibraryList(store, '自定义策略版本库');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const generation = useRef({ value: 0 });
  useEffect(() => {
    const lifetime = generation.current;
    return () => {
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
      await list.refresh();
      if (token !== generation.current.value) return false;
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
    records: list.items,
    libraryDiagnostic: list.diagnostic,
    busy: busy || list.state === 'loading',
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
