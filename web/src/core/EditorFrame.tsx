/**
 * The screens for a document that cannot be shown, and the two buttons they use.
 *
 * The frame itself is the shell now (core/shell/EditorShell.tsx). These are drawn
 * on the editor's desk, in the app's colour, for the moments before there is a
 * document: it is loading, it is not yours, it needs a sign-in.
 */

import type React from 'react';
import type { DocKind } from '@shared/api';
import { Link } from '../router';
import { useEditorTheme } from './appearance';
import { Button } from './controls';
import { signInHref } from '../theme';

/** A document that is not on screen, and the one thing to do about it. */
export function DocumentMessage({
  title,
  text,
  kind = 'docs',
  children
}: {
  title: string;
  text?: string;
  /** Whose colour the desk is: the kind of document that is not on screen. */
  kind?: DocKind;
  children?: React.ReactNode;
}) {
  const theme = useEditorTheme(kind);
  return (
    <div className="oa-shell" data-app={kind} {...(theme ? { 'data-theme': theme } : {})}>
      <div className="oa-message">
        <h1>{title}</h1>
        {text && <p>{text}</p>}
        <div className="oa-message-actions">{children}</div>
      </div>
    </div>
  );
}

export function HomeButton({ label = 'Back to documents' }: { label?: string }) {
  return (
    <Link to="/">
      <Button variant="secondary">{label}</Button>
    </Link>
  );
}

export function SignInButton() {
  return (
    <Button
      variant="primary"
      onClick={() => {
        window.location.href = signInHref(window.location.href);
      }}
    >
      Sign in
    </Button>
  );
}
