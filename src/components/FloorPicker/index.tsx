import React from "react";
import styles from "./FloorPicker.module.css";

import "@esri/calcite-components/components/calcite-panel";

interface FloorPickerProps {
    level: number;
    onLevelChange: (level: number) => void;
    slot?: string;
}

const levels = [1, 2, 3, 4];

export const FloorPicker: React.FC<FloorPickerProps> = ({
    level,
    onLevelChange,
    slot = "top-left",
}) => (
    <div slot={slot} className={styles.container}>
        <calcite-panel className={styles.panel} heading="Floors">
            <div className={styles.pickerRow}>
                <div className={styles.labels}>
                    {levels.map((item) => (
                        <span
                            key={item}
                            className={`${styles.label} ${level === item ? styles.selectedLabel : ""}`}
                            onClick={() => onLevelChange(Number(item))}
                        >
                            {`Level ${item}`}
                        </span>
                    ))}
                </div>
                <input
                    type="range"
                    min={1}
                    max={4}
                    step={1}
                    value={level}
                    onChange={(event) => onLevelChange(Number(event.target.value))}
                    className={styles.slider}
                    aria-label="Floor level picker"
                />
            </div>
        </calcite-panel>
    </div>
);
