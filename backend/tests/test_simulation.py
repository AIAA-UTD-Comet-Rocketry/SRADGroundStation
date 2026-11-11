from ground_station.config import SimulationConfig
from ground_station.schema import Phase
from ground_station.sources import RejectedPacket, SimFlight, SimulationSource, SourcePacket


def fly(apogee_ft: float) -> SimFlight:
    f = SimFlight(SimulationConfig(), apogee_ft)
    f.launch()
    phases = [f.state.phase]
    for _ in range(20_000):
        f.step(0.1)
        if f.state.phase != phases[-1]:
            phases.append(f.state.phase)
        if f.state.phase == Phase.LANDED:
            break
    f.phases = phases  # type: ignore[attr-defined]
    return f


def test_flight_hits_target_apogee_and_goes_through_phases():
    for target_ft in (10_000, 30_000, 45_000):
        f = fly(target_ft)
        assert abs(f.max_alt - target_ft * 0.3048) / (target_ft * 0.3048) < 0.01
        assert f.phases == [Phase.BOOST, Phase.COAST, Phase.DROGUE, Phase.MAIN, Phase.LANDED]
        assert f.state.alt == 0.0


def test_pad_stays_on_pad_until_launch():
    f = SimFlight(SimulationConfig(), 10_000)
    f.step(10)
    assert f.state.phase == Phase.PAD
    assert f.state.t == 0


def test_packet_loss_skips_sequence_numbers():
    src = SimulationSource(SimulationConfig(seed=1, packet_loss=0.5))
    got = [ev for ev in (src.tick(0.1) for _ in range(400)) if ev is not None]
    seqs = [ev.data.sequence for ev in got if isinstance(ev, SourcePacket)]
    assert 120 < len(seqs) < 280
    assert seqs == sorted(seqs)
    assert src.sequence == 400  # rocket counter advanced for every packet, lost or not


def test_dropout_and_corruption():
    src = SimulationSource(SimulationConfig(seed=2, packet_loss=0.0))
    src.trigger_dropout(1.0)
    assert all(src.tick(0.1) is None for _ in range(10))
    assert isinstance(src.tick(0.1), SourcePacket)

    src.set_corrupt_rate(1.0)
    assert isinstance(src.tick(0.1), RejectedPacket)


def test_pause_emits_nothing():
    src = SimulationSource(SimulationConfig(packet_loss=0.0))
    src.set_paused(True)
    assert src.tick(0.1) is None
