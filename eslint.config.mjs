import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  {
    ignores: ["python_backend/.venv/**", "python_backend/.uv-cache/**"]
  }
];

export default eslintConfig;
