const ErrorBanner = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div className="bg-red-50 text-red-700 border border-red-200 px-3 py-2 rounded flex items-center justify-between">
      <span>{message}</span>
      <button 
        onClick={onClose}
        className="ml-2 text-red-500 hover:text-red-700"
      >
        ×
      </button>
    </div>
  );
};

export default ErrorBanner;