const AQI_BANDS = [
  {
    key: "good",
    label: "Good",
    min: 0,
    max: 50,
    rank: 1,
    accent: "#2f9e44",
    summary: "Fresh air with little or no health risk.",
  },
  {
    key: "moderate",
    label: "Moderate",
    min: 51,
    max: 100,
    rank: 2,
    accent: "#d98e04",
    summary: "Usually fine, but unusually sensitive people should take care.",
  },
  {
    key: "sensitive",
    label: "Sensitive Groups",
    min: 101,
    max: 150,
    rank: 3,
    accent: "#ef6c00",
    summary: "Sensitive groups may feel the impact first.",
  },
  {
    key: "unhealthy",
    label: "Unhealthy",
    min: 151,
    max: 200,
    rank: 4,
    accent: "#d94841",
    summary: "Outdoor exposure starts becoming risky for everyone.",
  },
  {
    key: "very-unhealthy",
    label: "Very Unhealthy",
    min: 201,
    max: 300,
    rank: 5,
    accent: "#7a3db8",
    summary: "Health warnings are likely for the full population.",
  },
  {
    key: "hazardous",
    label: "Hazardous",
    min: 301,
    max: Number.POSITIVE_INFINITY,
    rank: 6,
    accent: "#7a0c2e",
    summary: "Emergency conditions. Limit outdoor time immediately.",
  },
];

export function getAqiBand(value) {
  const aqi = Number(value);

  if (!Number.isFinite(aqi) || aqi < 0) {
    return {
      key: "unknown",
      label: "Unknown",
      min: null,
      max: null,
      rank: 0,
      accent: "#6b7280",
      summary: "Live data has not arrived yet.",
    };
  }

  return AQI_BANDS.find((band) => aqi >= band.min && aqi <= band.max) ?? AQI_BANDS.at(-1);
}

export function formatAqi(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric).toString() : "--";
}

export function compareBandSeverity(currentAqi, previousAqi) {
  return getAqiBand(currentAqi).rank - getAqiBand(previousAqi).rank;
}

export function formatLocalTime(value) {
  if (!value) {
    return "Awaiting update";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date);
}

export function formatPollutantName(value) {
  const labelMap = {
    pm25: "PM2.5",
    pm10: "PM10",
    no2: "NO2",
    so2: "SO2",
    o3: "Ozone",
    co: "CO",
  };

  return labelMap[value] ?? (value ? value.toUpperCase() : "N/A");
}

export function averageAqi(items) {
  const values = items
    .map((item) => Number(item?.aqi))
    .filter((value) => Number.isFinite(value));

  if (!values.length) {
    return null;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function getWorstLocation(items) {
  return [...items].sort((left, right) => Number(right?.aqi ?? -1) - Number(left?.aqi ?? -1))[0] ?? null;
}

export function buildAlertMessage({ current, previous }) {
  const currentBand = getAqiBand(current?.aqi);
  const previousAqi = Number(previous?.aqi);
  const previousText = Number.isFinite(previousAqi)
    ? ` It was ${formatAqi(previousAqi)} in ${previous.city}.`
    : "";
  const pollutant = current?.dominantPollutant
    ? ` Dominant pollutant: ${formatPollutantName(current.dominantPollutant)}.`
    : "";

  return `AirWatch alert: you reached ${current?.city ?? "your current area"} where AQI is ${formatAqi(current?.aqi)} (${currentBand.label}).${previousText}${pollutant}`;
}

export const AQI_LEGEND = AQI_BANDS;
