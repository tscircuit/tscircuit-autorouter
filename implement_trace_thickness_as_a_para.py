import math

class TraceThickness:
    def __init__(self):
        self.thickness_multiples = {
            "2x": 0.3,
            "4x": 0.6,
            "8x": 1.2
        }

    @staticmethod
    def calculate_trace_width(length, orientation):
        if orientation == "horizontal":
            return length * TraceThickness.thickness_multiples["2x"]
        elif orientation == "vertical":
            return math.pi / 4 * length * TraceThickness.thickness_multiples["2x"]
        else:
            raise ValueError("Invalid orientation")

    def get_trace_thickness(self, index):
        if index in self.thickness_multiples:
            return self.thickness_multiples[index]
        else:
            raise ValueError("Invalid trace thickness")
```

This code provides a `TraceThickness` class that includes the standard data line thickness and allows for the addition of custom trace thickness multiples. It also calculates the trace width based on its orientation and length.