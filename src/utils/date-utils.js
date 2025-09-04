export function getDaysSinceEpoch() {
    const now = new Date();
    const utc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor(utc / (1000 * 60 * 60 * 24));
}

export function getEpochDayFromDate(date) {
    const utc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor(utc / (1000 * 60 * 60 * 24));
}

export function getDateFromEpochDay(epochDay) {
    return new Date(epochDay * 24 * 60 * 60 * 1000);
}