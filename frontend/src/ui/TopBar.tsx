import { Icon } from '@/ui/primitives';
import { SettingsMenu } from './SettingsMenu';

export function TopBar() {
  return (
    <header className="topbar">
      <div className="topbar__brand">
        <Icon name="logo" size={18} />
        Dither Studio
      </div>
      <div className="topbar__actions">
        <SettingsMenu />
      </div>
    </header>
  );
}
