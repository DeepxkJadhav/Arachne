import { config } from "../config";
export function isSelfHosted(): boolean {
  return config.USE_DB_AUTHENTICATION !== true;
}

export function getErrorContactMessage(errorId?: string): string {
  if (isSelfHosted()) {
    return errorId
      ? `An error occurred. Please check your logs or report at https://github.com/DeepxkJadhav/Arachne/issues. Error ID: ${errorId}`
      : "An error occurred. Please check your logs or report at https://github.com/DeepxkJadhav/Arachne/issues.";
  } else {
    return errorId
      ? `An unexpected error occurred. Please report at https://github.com/DeepxkJadhav/Arachne/issues. Your exception ID is ${errorId}`
      : "An unexpected error occurred. Please report at https://github.com/DeepxkJadhav/Arachne/issues.";
  }
}
