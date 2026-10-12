'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';
import { AVATAR_COLORS } from '@/lib/validation/profile';
import {
  updateProfileAction,
  changePasswordAction,
  becomeAuthorAction,
  revokeSessionsAction,
} from '@/app/profile/actions';
import type { ActionResult } from '@/lib/actionResult';
import type { AuthUser, UserProfile } from '@/lib/types';
import styles from './AccountSettingsView.module.css';

const ROLE_LABELS: Record<AuthUser['role'], string> = {
  reader: '讀者',
  author: '作者 / 讀者',
  admin: '管理員',
};

interface Feedback {
  tone: 'success' | 'error';
  message: string;
}

type Fields = Record<string, string>;

/**
 * 個人設定的四項操作（FR-021／FR-023／FR-024／FR-026）。
 *
 * FEAT-1 的這一頁是停用的，並以「功能開發中」誠實標示；本階段接上真實寫入後，
 * 該標示連同假的送出流程一併移除（FR-016）。
 *
 * **兩段告知文案 MUST NOT 混用**（FR-026）：
 *   - 改密碼：**含本裝置**一起登出，需以新密碼重新登入
 *   - 開通作者：只登出**其他裝置**，本裝置無須重新登入
 * 混用的後果不是文案不精確，而是使用者按下按鈕後遇到的事和被告知的不一樣。
 */
export function AccountSettingsView({ profile }: { profile: UserProfile }) {
  const router = useRouter();
  const { user } = useAuth();

  const bioId = useId();
  const avatarGroupId = useId();
  const passwordNoteId = useId();
  const upgradeNoteId = useId();
  const revokeNoteId = useId();

  // ── 個人資料 ──
  const [name, setName] = useState(profile.name);
  const [penName, setPenName] = useState(profile.penName);
  const [bio, setBio] = useState(profile.bio);
  /**
   * `null` = 使用者這次沒有動頭像色。
   *
   * **MUST NOT 以 `profile.avatarColor` 當初始值直接送出**：資料庫的預設值
   * （`linear-gradient(135deg,#d97706,#92400e)`，緊湊寫法）**不在 `AVATAR_COLORS` 之內**
   * ——畫出來一樣，字串不同。以它當初始值原樣送出，會讓每一個新註冊的使用者
   * 連改暱稱都存不了（整筆被 `avatarColor` 的白名單擋下），
   * 而錯誤訊息會指向一個他根本沒碰過的欄位。
   */
  const [avatarColor, setAvatarColor] = useState<string | null>(null);
  const currentAvatarColor = avatarColor ?? profile.avatarColor;
  const currentIsInPalette = (AVATAR_COLORS as readonly string[]).includes(currentAvatarColor);
  const [profileFeedback, setProfileFeedback] = useState<Feedback | null>(null);
  const [profileFields, setProfileFields] = useState<Fields>({});
  const [savingProfile, setSavingProfile] = useState(false);

  // ── 變更密碼 ──
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback | null>(null);
  const [passwordFields, setPasswordFields] = useState<Fields>({});
  const [savingPassword, setSavingPassword] = useState(false);

  // ── 開通作者 ──
  const [upgradePenName, setUpgradePenName] = useState('');
  const [upgradeFeedback, setUpgradeFeedback] = useState<Feedback | null>(null);
  const [upgradeFields, setUpgradeFields] = useState<Fields>({});
  const [upgrading, setUpgrading] = useState(false);

  // ── 登出所有裝置 ──
  const [revokeFeedback, setRevokeFeedback] = useState<Feedback | null>(null);
  const [revoking, setRevoking] = useState(false);

  if (!user) return null;

  /** 失敗時回傳欄位訊息，成功時回 null —— 呼叫端據此決定接下來要不要導頁 */
  function applyFailure(
    result: ActionResult,
    setFeedback: (f: Feedback | null) => void,
    setFields: (f: Fields) => void
  ): boolean {
    if (result.success) {
      setFields({});
      return true;
    }
    setFields(result.error.fields ?? {});
    setFeedback({ tone: 'error', message: result.error.message });
    return false;
  }

  async function onSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileFeedback(null);
    try {
      const result = await updateProfileAction({
        name,
        penName,
        bio,
        // 沒動過就不帶這個欄位 —— schema 各欄位皆選填，缺席即「不動」
        ...(avatarColor !== null ? { avatarColor } : {}),
      });
      if (applyFailure(result, setProfileFeedback, setProfileFields)) {
        setProfileFeedback({ tone: 'success', message: '個人資料已更新。' });
        // 導覽列的顯示名與頭像色來自伺服器渲染的工作階段，需重新取一次才會同步
        router.refresh();
      }
    } finally {
      setSavingProfile(false);
    }
  }

  async function onChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setSavingPassword(true);
    setPasswordFeedback(null);
    try {
      const result = await changePasswordAction({ currentPassword, newPassword });
      if (applyFailure(result, setPasswordFeedback, setPasswordFields)) {
        // 成功後全部工作階段（含本裝置）皆已失效，留在原頁只會看到一連串 401
        router.push('/auth/login');
        router.refresh();
      }
    } finally {
      setSavingPassword(false);
    }
  }

  async function onBecomeAuthor(e: React.FormEvent) {
    e.preventDefault();
    setUpgrading(true);
    setUpgradeFeedback(null);
    try {
      const result = await becomeAuthorAction({ penName: upgradePenName });
      if (applyFailure(result, setUpgradeFeedback, setUpgradeFields)) {
        setUpgradeFeedback({ tone: 'success', message: '已開通作者身分，可以開始建立作品了。' });
        router.refresh();
      }
    } finally {
      setUpgrading(false);
    }
  }

  async function onRevokeSessions() {
    setRevoking(true);
    setRevokeFeedback(null);
    try {
      const result = await revokeSessionsAction();
      if (result.success) {
        router.push('/auth/login');
        router.refresh();
      } else {
        setRevokeFeedback({ tone: 'error', message: result.error.message });
      }
    } finally {
      setRevoking(false);
    }
  }

  const feedbackNode = (feedback: Feedback | null) =>
    feedback ? (
      <p
        className={feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess}
        role={feedback.tone === 'error' ? 'alert' : 'status'}
      >
        {feedback.message}
      </p>
    ) : null;

  return (
    <div className={styles.view}>
      <section className={styles.section}>
        <h2 className={styles.section__title}>個人資料</h2>
        <form className={styles.form} onSubmit={onSaveProfile} noValidate>
          <Input
            label="暱稱"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={profileFields.name}
            fullWidth
          />
          <Input
            label="筆名"
            value={penName}
            onChange={(e) => setPenName(e.target.value)}
            error={profileFields.penName}
            hint="作品的公開顯示名；留空則使用暱稱"
            fullWidth
          />
          <Input label="Email" value={user.email} disabled fullWidth hint="Email 無法變更" />

          <div className={styles.field}>
            <label className={styles.field__label} htmlFor={bioId}>
              個人簡介
            </label>
            <textarea
              id={bioId}
              className={styles.textarea}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              {...(profileFields.bio
                ? { 'aria-invalid': true, 'aria-describedby': `${bioId}-error` }
                : {})}
            />
            {profileFields.bio ? (
              <p id={`${bioId}-error`} className={styles.fieldError}>
                {profileFields.bio}
              </p>
            ) : (
              <p className={styles.field__hint}>顯示於你的作品詳情頁；可留空</p>
            )}
          </div>

          <fieldset className={styles.colorGroup}>
            <legend className={styles.field__label} id={avatarGroupId}>
              頭像色
            </legend>
            <div className={styles.colorGroup__options}>
              {AVATAR_COLORS.map((color, index) => (
                <label key={color} className={styles.colorOption}>
                  <input
                    type="radio"
                    name="avatarColor"
                    value={color}
                    checked={currentAvatarColor === color}
                    onChange={() => setAvatarColor(color)}
                    className={styles.colorOption__input}
                  />
                  <span className={styles.colorOption__swatch} style={{ background: color }} />
                  <span className={styles.srOnly}>色票 {index + 1}</span>
                </label>
              ))}
            </div>
            {currentIsInPalette ? null : (
              <p className={styles.field__hint}>
                你目前的頭像色不在這組色票內，選一個即可更換；不選則維持原樣。
              </p>
            )}
          </fieldset>

          <Button type="submit" className={styles.form__submit} disabled={savingProfile}>
            {savingProfile ? '儲存中…' : '儲存變更'}
          </Button>
          {feedbackNode(profileFeedback)}
        </form>
      </section>

      <section className={styles.section}>
        <h2 className={styles.section__title}>變更密碼</h2>
        <form className={styles.form} onSubmit={onChangePassword} noValidate>
          <Input
            label="目前密碼"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            error={passwordFields.currentPassword}
            autoComplete="current-password"
            fullWidth
          />
          <Input
            label="新密碼"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            error={passwordFields.newPassword}
            hint="至少 8 個字元，須包含英文字母與數字"
            autoComplete="new-password"
            fullWidth
          />
          <p id={passwordNoteId} className={styles.notice}>
            變更密碼後<strong>將登出所有裝置（含目前這一台）</strong>，需以新密碼重新登入。
          </p>
          <Button
            type="submit"
            className={styles.form__submit}
            aria-describedby={passwordNoteId}
            disabled={savingPassword}
          >
            {savingPassword ? '變更中…' : '變更密碼'}
          </Button>
          {feedbackNode(passwordFeedback)}
        </form>
      </section>

      {user.role === 'reader' ? (
        <section className={styles.section}>
          <h2 className={styles.section__title}>成為作者</h2>
          <form className={styles.form} onSubmit={onBecomeAuthor} noValidate>
            <Input
              label="筆名"
              value={upgradePenName}
              onChange={(e) => setUpgradePenName(e.target.value)}
              error={upgradeFields.penName}
              hint="作品的公開顯示名，開通後仍可修改"
              fullWidth
            />
            <p id={upgradeNoteId} className={styles.notice}>
              開通作者身分後<strong>其他裝置將被登出</strong>，本裝置無須重新登入。
            </p>
            <Button
              type="submit"
              className={styles.form__submit}
              aria-describedby={upgradeNoteId}
              disabled={upgrading}
            >
              {upgrading ? '開通中…' : '開通作者身分'}
            </Button>
            {feedbackNode(upgradeFeedback)}
          </form>
        </section>
      ) : null}

      <section className={styles.section}>
        <h2 className={styles.section__title}>登出所有裝置</h2>
        <p id={revokeNoteId} className={styles.notice}>
          會使<strong>全部裝置（含目前這一台）</strong>的登入狀態失效，需重新登入。
        </p>
        <Button
          type="button"
          variant="secondary"
          className={styles.form__submit}
          aria-describedby={revokeNoteId}
          onClick={onRevokeSessions}
          disabled={revoking}
        >
          {revoking ? '處理中…' : '登出所有裝置'}
        </Button>
        {feedbackNode(revokeFeedback)}
      </section>

      <section className={styles.section}>
        <h2 className={styles.section__title}>帳號資訊</h2>
        <dl className={styles.infoList}>
          <div className={styles.infoList__row}>
            <dt>加入時間</dt>
            <dd>{user.createdAt}</dd>
          </div>
          <div className={styles.infoList__row}>
            <dt>身分</dt>
            <dd>{ROLE_LABELS[user.role]}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
