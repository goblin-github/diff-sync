import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[DiffSync] 未捕获的渲染异常:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-zinc-950">
          <div className="text-center space-y-4 max-w-md">
            <span className="text-5xl">💥</span>
            <h2 className="text-lg font-bold text-zinc-200">应用遇到错误</h2>
            <p className="text-xs text-zinc-500 leading-relaxed">
              {this.state.error?.message || '未知错误'}
            </p>
            <p className="text-[10px] text-zinc-600">
              请尝试重启应用。如问题持续出现，请检查数据文件是否损坏。
            </p>
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-700 transition cursor-pointer"
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
