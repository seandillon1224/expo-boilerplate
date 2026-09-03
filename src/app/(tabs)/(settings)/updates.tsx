import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useUpdateInfo } from '@/features/updates/use-update-info';
import {
  type SkipReason,
  type UpdatePolicy,
  useUpdatePolicy,
} from '@/features/updates/use-update-policy';
import { Pressable, ScrollView, Text, View } from '@/tw';

type CheckStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available' }
  | { kind: 'up-to-date' }
  | { kind: 'skipped'; reason: SkipReason }
  | { kind: 'error'; message: string };

/** Static keys so `i18n:extract` sees every policy label. */
function policyLabel(t: ReturnType<typeof useTranslation>['t'], policy: UpdatePolicy): string {
  switch (policy) {
    case 'manual':
      return t('updates.policies.manual');
    case 'forced':
      return t('updates.policies.forced');
    case 'opt-in':
      return t('updates.policies.opt-in');
    case 'silent':
      return t('updates.policies.silent');
  }
}

function Row({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <View testID={`updates-row-${id}`} className="border-border gap-0.5 border-b py-3">
      <Text className="text-muted-foreground text-xs uppercase">{label}</Text>
      <Text className="text-foreground" selectable>
        {value}
      </Text>
    </View>
  );
}

export default function UpdatesScreen() {
  const { t } = useTranslation();
  const info = useUpdateInfo();
  const { policy, checkForUpdate, downloadAndReload } = useUpdatePolicy();
  const [status, setStatus] = useState<CheckStatus>({ kind: 'idle' });
  const [applyError, setApplyError] = useState<string | null>(null);

  const none = t('updates.none');
  const busy = status.kind === 'checking' || info.isChecking || info.isDownloading;
  const updateAvailable = status.kind === 'available' || info.availableUpdate !== undefined;

  const onCheck = async () => {
    setStatus({ kind: 'checking' });
    try {
      const result = await checkForUpdate();
      if (result.skipped) setStatus({ kind: 'skipped', reason: result.skipped });
      else setStatus({ kind: result.isAvailable ? 'available' : 'up-to-date' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const onApply = async () => {
    setApplyError(null);
    try {
      const result = await downloadAndReload();
      if (result.skipped) setStatus({ kind: 'skipped', reason: result.skipped });
      else if (!result.isNew) setStatus({ kind: 'up-to-date' });
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error));
    }
  };

  let statusText: string | null = null;
  switch (status.kind) {
    case 'checking':
      statusText = t('updates.status.checking');
      break;
    case 'available':
      statusText = t('updates.status.available');
      break;
    case 'up-to-date':
      statusText = t('updates.status.upToDate');
      break;
    case 'skipped':
      statusText =
        status.reason === 'dev'
          ? t('updates.status.skippedDev')
          : t('updates.status.skippedDisabled');
      break;
    case 'error':
      statusText = t('updates.status.error', { message: status.message });
      break;
    case 'idle':
      statusText = info.checkError
        ? t('updates.status.error', { message: info.checkError.message })
        : null;
  }

  return (
    <ScrollView
      testID="updates-screen"
      className="bg-background flex-1"
      contentContainerClassName="px-6 py-4"
    >
      <Row
        id="runtimeVersion"
        label={t('updates.rows.runtimeVersion')}
        value={info.runtimeVersion ?? none}
      />
      <Row id="channel" label={t('updates.rows.channel')} value={info.channel ?? none} />
      <Row id="updateId" label={t('updates.rows.updateId')} value={info.updateId ?? none} />
      <Row
        id="source"
        label={t('updates.rows.source')}
        value={info.isEmbeddedLaunch ? t('updates.values.embedded') : t('updates.values.ota')}
      />
      <Row
        id="createdAt"
        label={t('updates.rows.createdAt')}
        value={info.createdAt ? info.createdAt.toISOString() : none}
      />
      <Row
        id="enabled"
        label={t('updates.rows.enabled')}
        value={info.isEnabled ? t('updates.values.yes') : t('updates.values.no')}
      />
      <Row id="policy" label={t('updates.rows.policy')} value={policyLabel(t, policy)} />

      <View className="mt-6 gap-3">
        <Pressable
          testID="updates-check"
          accessibilityRole="button"
          disabled={busy}
          onPress={onCheck}
          className="bg-primary items-center rounded-md px-4 py-3"
        >
          <Text className="text-primary-foreground font-semibold">
            {busy ? t('updates.checking') : t('updates.check')}
          </Text>
        </Pressable>
        {statusText ? (
          <Text testID="updates-status" className="text-muted-foreground text-center">
            {statusText}
          </Text>
        ) : null}
        {updateAvailable ? (
          <Pressable
            testID="updates-apply"
            accessibilityRole="button"
            disabled={info.isDownloading}
            onPress={onApply}
            className="bg-muted items-center rounded-md px-4 py-3"
          >
            <Text className="text-foreground font-semibold">
              {info.isDownloading ? t('updates.downloading') : t('updates.apply')}
            </Text>
          </Pressable>
        ) : null}
        {applyError ? (
          <Text testID="updates-apply-error" className="text-muted-foreground text-center">
            {t('updates.status.error', { message: applyError })}
          </Text>
        ) : null}
        {info.isUpdatePending ? (
          <Text testID="updates-pending" className="text-muted-foreground text-center">
            {t('updates.pending')}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
