import { Navigate } from 'react-router-dom';

// Wildberries shares the import workspace, status history and recovery actions.
export function ParsingPage() {
  return <Navigate to="/upload?source=parsing" replace />;
}
