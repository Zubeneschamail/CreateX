import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Save, X } from "lucide-react";
import {
  AI_PROVIDER_OPTIONS,
  AiProvider,
  DEFAULT_MODEL_BY_PROVIDER,
  isAiProvider,
  isKnownModelForProvider,
} from "./aiModels";

export type AiSettings = {
  apiKey: string;
  model: string;
  provider: AiProvider;
};

type SettingsDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: AiSettings) => void;
  settings: AiSettings;
};

function SettingsDialog({
  isOpen,
  onClose,
  onSave,
  settings,
}: SettingsDialogProps) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [provider, setProvider] = useState<AiProvider>(settings.provider);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setApiKey(settings.apiKey);
    setProvider(settings.provider);
  }, [isOpen, settings]);

  if (!isOpen) {
    return null;
  }

  const activeProvider = AI_PROVIDER_OPTIONS.find(
    (option) => option.value === provider,
  );
  const keyLabel =
    provider === "openrouter" ? "OpenRouter API Key" : "OpenAI API Key";
  const keyPlaceholder =
    provider === "openrouter" ? "sk-or-v1-..." : "sk-...";

  const changeProvider = (nextValue: string) => {
    if (!isAiProvider(nextValue)) {
      return;
    }

    setProvider(nextValue);
  };

  const saveSettings = (event: FormEvent) => {
    event.preventDefault();
    const model =
      provider === settings.provider &&
      isKnownModelForProvider(provider, settings.model)
        ? settings.model
        : DEFAULT_MODEL_BY_PROVIDER[provider];

    onSave({
      apiKey: apiKey.trim(),
      model,
      provider,
    });
    onClose();
  };

  return (
    <div className="ai-dialog-backdrop" role="presentation">
      <section aria-label="设置" className="ai-dialog settings-dialog">
        <header className="ai-dialog-header">
          <div>
            <h2>设置</h2>
            <p>配置本地 AI 生成所需的服务商和 Key。</p>
          </div>
          <button
            aria-label="关闭设置"
            className="compact-icon-button"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </header>

        <form className="ai-dialog-body" onSubmit={saveSettings}>
          <label className="settings-field">
            <span>服务商</span>
            <select
              onChange={(event) => changeProvider(event.target.value)}
              value={provider}
            >
              {AI_PROVIDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small>{activeProvider?.description}</small>
          </label>

          <label className="settings-field">
            <span>{keyLabel}</span>
            <div className="settings-input-wrap">
              <KeyRound size={16} />
              <input
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={keyPlaceholder}
                type="password"
                value={apiKey}
              />
            </div>
          </label>

          <p className="settings-note">
            API Key 只保存在当前浏览器。模型选择已移到 AI 生成模型窗口。
          </p>

          <div className="ai-dialog-actions">
            <button className="secondary-button" onClick={onClose} type="button">
              取消
            </button>
            <button className="primary-button" type="submit">
              <Save size={16} />
              <span>保存</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export default SettingsDialog;
