import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] px-4 text-center">
          <div className="h-16 w-16 rounded-2xl bg-red-100 flex items-center justify-center mb-4">
            <AlertTriangle className="h-8 w-8 text-red-500" />
          </div>
          <h2 className="text-lg font-semibold text-neutral-800 dark:text-neutral-100 mb-2">
            Что-то пошло не так
          </h2>
          <p className="text-sm text-neutral-500 max-w-sm mb-6">
            {this.state.error.message || 'Произошла непредвиденная ошибка.'}
          </p>
          <button
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            className="btn-primary"
          >
            <RefreshCw className="h-4 w-4" />
            Перезагрузить
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
